package service

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/sirupsen/logrus"
)

// CheckpointMetadataReader defines filesystem operations needed to read checkpoint files.
type CheckpointMetadataReader interface {
	OpenFile(path string) (io.ReadCloser, error)
}

// CheckpointMetadataService parses safetensors file headers to extract training metadata.
type CheckpointMetadataService struct {
	reader         CheckpointMetadataReader
	checkpointDirs []string
	loraDirs       []string
	logger         *logrus.Entry
}

// NewCheckpointMetadataService creates a checkpoint metadata service.
func NewCheckpointMetadataService(reader CheckpointMetadataReader, checkpointDirs []string, loraDirs []string, logger *logrus.Logger) *CheckpointMetadataService {
	return &CheckpointMetadataService{
		reader:         reader,
		checkpointDirs: checkpointDirs,
		loraDirs:       loraDirs,
		logger:         logger.WithField("component", "checkpoint_metadata"),
	}
}

// GetMetadata reads the safetensors header for the given filename and returns
// ss_* metadata fields. The filename is resolved against checkpoint_dirs.
// Returns an empty map (not an error) when no ss_* fields are present.
func (s *CheckpointMetadataService) GetMetadata(filename string) (map[string]string, error) {
	s.logger.WithField("filename", filename).Trace("entering GetMetadata")
	defer s.logger.Trace("returning from GetMetadata")

	// Validate filename is safe (no path traversal)
	if !isFilenameSafe(filename) {
		s.logger.WithField("filename", filename).Warn("invalid filename rejected")
		return nil, fmt.Errorf("invalid filename: %q: %w", filename, ErrInvalidFilename)
	}

	// Find the file across checkpoint_dirs
	filePath, err := s.resolveCheckpointFile(filename)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"filename": filename,
			"error":    err.Error(),
		}).Error("failed to resolve checkpoint file")
		return nil, err
	}
	s.logger.WithFields(logrus.Fields{
		"filename": filename,
		"path":     filePath,
	}).Debug("checkpoint file resolved")

	// Parse safetensors header
	metadata, err := parseSafetensorsMetadata(s.reader, filePath)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"filename": filename,
			"error":    err.Error(),
		}).Error("failed to parse safetensors metadata")
		return nil, fmt.Errorf("parsing safetensors header: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"filename":       filename,
		"metadata_count": len(metadata),
	}).Debug("safetensors metadata extracted")

	return metadata, nil
}

// resolveCheckpointFile finds the first matching checkpoint file across all checkpoint_dirs
// and lora_dirs. checkpoint_dirs are searched first.
func (s *CheckpointMetadataService) resolveCheckpointFile(filename string) (string, error) {
	allDirs := make([]string, 0, len(s.checkpointDirs)+len(s.loraDirs))
	allDirs = append(allDirs, s.checkpointDirs...)
	allDirs = append(allDirs, s.loraDirs...)

	for _, dir := range allDirs {
		// Walk the directory to find the file
		var found string
		_ = filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				return nil
			}
			if info.Name() == filename {
				// Verify resolved path stays within the search dir
				cleanDir := filepath.Clean(dir)
				cleanPath := filepath.Clean(path)
				if strings.HasPrefix(cleanPath, cleanDir+string(filepath.Separator)) || cleanPath == cleanDir {
					found = path
					return filepath.SkipAll
				}
			}
			return nil
		})
		if found != "" {
			return found, nil
		}
	}
	return "", fmt.Errorf("checkpoint file not found: %q: %w", filename, ErrNotFound)
}

// isFilenameSafe checks that a filename does not contain path traversal components.
func isFilenameSafe(filename string) bool {
	if filename == "" {
		return false
	}
	// Must not contain path separators
	if strings.ContainsAny(filename, "/\\") {
		return false
	}
	// Must not be . or ..
	if filename == "." || filename == ".." {
		return false
	}
	return true
}

// parseSafetensorsMetadata reads the safetensors file header and extracts ss_* fields
// from the __metadata__ section.
func parseSafetensorsMetadata(reader CheckpointMetadataReader, path string) (map[string]string, error) {
	f, err := reader.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("opening file: %w", err)
	}
	defer f.Close()

	// Read header length (first 8 bytes, little-endian uint64)
	var headerLen uint64
	if err := binary.Read(f, binary.LittleEndian, &headerLen); err != nil {
		return nil, fmt.Errorf("reading header length: %w", err)
	}

	// Sanity check: header shouldn't be absurdly large (16MB limit).
	// Real safetensors headers are KBs to low MBs; 16MB is ample headroom.
	const maxHeaderLen = 16 * 1024 * 1024
	if headerLen > maxHeaderLen {
		return nil, fmt.Errorf("header length %d exceeds maximum %d bytes", headerLen, maxHeaderLen)
	}

	// Validate headerLen against actual file size before allocating.
	// A file declaring a header larger than the remaining bytes is corrupt.
	// We type-assert to the Stat interface that *os.File satisfies.
	type stater interface {
		Stat() (os.FileInfo, error)
	}
	if st, ok := f.(stater); ok {
		if info, err := st.Stat(); err == nil {
			// File size minus 8 bytes already consumed for the length prefix.
			remaining := info.Size() - 8
			if remaining < 0 {
				remaining = 0
			}
			if int64(headerLen) > remaining {
				return nil, fmt.Errorf("header length %d exceeds remaining file size %d", headerLen, remaining)
			}
		}
	}

	// Read header JSON
	headerBytes := make([]byte, headerLen)
	if _, err := io.ReadFull(f, headerBytes); err != nil {
		return nil, fmt.Errorf("reading header data: %w", err)
	}

	// Parse JSON: the header is a map of tensor names to tensor info,
	// plus an optional __metadata__ key with string→string pairs.
	var header map[string]json.RawMessage
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("parsing header JSON: %w", err)
	}

	metadataRaw, ok := header["__metadata__"]
	if !ok {
		return map[string]string{}, nil
	}

	var allMetadata map[string]string
	if err := json.Unmarshal(metadataRaw, &allMetadata); err != nil {
		return nil, fmt.Errorf("parsing __metadata__: %w", err)
	}

	// Filter to ss_* fields only
	result := make(map[string]string)
	for k, v := range allMetadata {
		if strings.HasPrefix(k, "ss_") {
			result[k] = v
		}
	}

	return result, nil
}

// MetadataKeys returns the ss_* keys from a metadata map in sorted order.
func MetadataKeys(metadata map[string]string) []string {
	keys := make([]string, 0, len(metadata))
	for k := range metadata {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
