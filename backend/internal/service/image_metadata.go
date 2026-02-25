package service

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/sirupsen/logrus"
)

// ImageMetadataReader defines filesystem operations needed to read image files.
type ImageMetadataReader interface {
	OpenFile(path string) (io.ReadCloser, error)
}

// ImageMetadataService parses image metadata from JSON sidecar files (preferred)
// or falls back to PNG tEXt chunk parsing for backward compatibility.
type ImageMetadataService struct {
	reader    ImageMetadataReader
	sampleDir string
	logger    *logrus.Entry
}

// NewImageMetadataService creates an image metadata service.
func NewImageMetadataService(reader ImageMetadataReader, sampleDir string, logger *logrus.Logger) *ImageMetadataService {
	return &ImageMetadataService{
		reader:    reader,
		sampleDir: sampleDir,
		logger:    logger.WithField("component", "image_metadata"),
	}
}

// GetMetadata reads metadata for the image at the given relative path (within sampleDir).
// It first checks for a JSON sidecar file (same base name, .json extension). If found,
// the sidecar is parsed and returned. If no sidecar exists, it falls back to parsing
// PNG tEXt chunks. Returns an empty map (not error) when no metadata is available.
func (s *ImageMetadataService) GetMetadata(relPath string) (map[string]string, error) {
	s.logger.WithField("relative_path", relPath).Trace("entering GetMetadata")
	defer s.logger.Trace("returning from GetMetadata")

	if !isPathSafe(relPath) {
		s.logger.WithField("relative_path", relPath).Warn("invalid path rejected")
		return nil, fmt.Errorf("invalid path: %q", relPath)
	}

	absPath := filepath.Join(s.sampleDir, filepath.FromSlash(relPath))

	// Double-check resolved path stays within sampleDir
	cleanRoot := filepath.Clean(s.sampleDir)
	cleanPath := filepath.Clean(absPath)
	if !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) && cleanPath != cleanRoot {
		s.logger.WithField("relative_path", relPath).Warn("path traversal attempt rejected")
		return nil, fmt.Errorf("invalid path: %q", relPath)
	}

	s.logger.WithFields(logrus.Fields{
		"relative_path": relPath,
		"absolute_path": absPath,
	}).Debug("resolved image path")

	// Derive sidecar path: replace image extension with .json
	ext := filepath.Ext(absPath)
	sidecarPath := absPath[:len(absPath)-len(ext)] + ".json"

	// Try sidecar-first
	sidecarMeta, err := parseSidecarJSON(s.reader, sidecarPath)
	if err == nil {
		s.logger.WithFields(logrus.Fields{
			"relative_path":  relPath,
			"sidecar_path":   sidecarPath,
			"metadata_count": len(sidecarMeta),
		}).Debug("metadata read from sidecar")
		return sidecarMeta, nil
	}

	// Sidecar not found or unreadable — fall back to PNG tEXt chunks
	if !errors.Is(err, os.ErrNotExist) {
		s.logger.WithFields(logrus.Fields{
			"sidecar_path": sidecarPath,
			"error":        err.Error(),
		}).Debug("sidecar read failed, falling back to PNG metadata")
	} else {
		s.logger.WithField("sidecar_path", sidecarPath).Debug("no sidecar found, reading PNG metadata")
	}

	metadata, err := parsePNGTextChunks(s.reader, absPath)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"relative_path": relPath,
			"error":         err.Error(),
		}).Error("failed to parse PNG metadata")
		return nil, fmt.Errorf("parsing PNG metadata: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"relative_path":  relPath,
		"metadata_count": len(metadata),
	}).Debug("PNG metadata extracted")

	return metadata, nil
}

// parseSidecarJSON reads a JSON sidecar file and returns its contents as a flat
// string map. Returns os.ErrNotExist (wrapped) when the file does not exist.
func parseSidecarJSON(reader ImageMetadataReader, path string) (map[string]string, error) {
	f, err := reader.OpenFile(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, fmt.Errorf("reading sidecar: %w", err)
	}

	// Unmarshal into a generic map so we handle any JSON object
	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("unmarshaling sidecar JSON: %w", err)
	}

	// Convert all values to strings for a uniform flat key-value response
	result := make(map[string]string, len(raw))
	for k, v := range raw {
		switch val := v.(type) {
		case string:
			result[k] = val
		case nil:
			result[k] = ""
		default:
			// Numbers, booleans, nested objects — marshal back to compact JSON string
			b, err := json.Marshal(val)
			if err != nil {
				result[k] = fmt.Sprintf("%v", val)
			} else {
				result[k] = string(b)
			}
		}
	}

	return result, nil
}

// isPathSafe checks that a relative path does not contain path traversal components.
// This is the service-layer equivalent of the api-layer isPathSafe.
func isPathSafe(p string) bool {
	if p == "" {
		return false
	}
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") {
		return false
	}
	parts := strings.Split(filepath.ToSlash(p), "/")
	for _, part := range parts {
		if part == ".." || part == "." {
			return false
		}
	}
	return true
}

// parsePNGTextChunks reads a PNG file and extracts key-value pairs from tEXt chunks.
func parsePNGTextChunks(reader ImageMetadataReader, path string) (map[string]string, error) {
	f, err := reader.OpenFile(path)
	if err != nil {
		return nil, fmt.Errorf("opening file: %w", err)
	}
	defer f.Close()

	// Read and validate PNG signature
	var sig [8]byte
	if _, err := io.ReadFull(f, sig[:]); err != nil {
		return nil, fmt.Errorf("reading PNG signature: %w", err)
	}
	expectedSig := [8]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	if sig != expectedSig {
		return nil, fmt.Errorf("not a PNG file")
	}

	result := make(map[string]string)

	// Read chunks until IEND or EOF
	for {
		// Read chunk length (4 bytes, big-endian)
		var length uint32
		if err := binary.Read(f, binary.BigEndian, &length); err != nil {
			if err == io.EOF || err == io.ErrUnexpectedEOF {
				break
			}
			return nil, fmt.Errorf("reading chunk length: %w", err)
		}

		// Sanity check: chunk shouldn't be absurdly large (100MB limit)
		const maxChunkLen = 100 * 1024 * 1024
		if length > maxChunkLen {
			return nil, fmt.Errorf("chunk length %d exceeds maximum %d", length, maxChunkLen)
		}

		// Read chunk type (4 bytes)
		var chunkType [4]byte
		if _, err := io.ReadFull(f, chunkType[:]); err != nil {
			break
		}

		typeStr := string(chunkType[:])

		if typeStr == "IEND" {
			break
		}

		if typeStr == "tEXt" {
			// Read chunk data
			data := make([]byte, length)
			if _, err := io.ReadFull(f, data); err != nil {
				break
			}

			// Parse tEXt: keyword\0text
			nullIdx := bytes.IndexByte(data, 0)
			if nullIdx >= 0 && nullIdx < len(data)-1 {
				key := string(data[:nullIdx])
				value := string(data[nullIdx+1:])
				result[key] = value
			}

			// Skip CRC (4 bytes)
			var crc [4]byte
			if _, err := io.ReadFull(f, crc[:]); err != nil {
				break
			}
		} else {
			// Skip chunk data + CRC (4 bytes)
			skipLen := int64(length) + 4
			if _, err := io.CopyN(io.Discard, f, skipLen); err != nil {
				break
			}
		}
	}

	return result, nil
}
