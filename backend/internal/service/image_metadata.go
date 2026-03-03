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

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
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
// the sidecar is parsed and returned with typed fields. If no sidecar exists, it falls
// back to parsing PNG tEXt chunks (all values are strings in that case).
// Returns an empty ImageMetadataValues (not error) when no metadata is available.
func (s *ImageMetadataService) GetMetadata(relPath string) (*model.ImageMetadataValues, error) {
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
			"relative_path":        relPath,
			"sidecar_path":         sidecarPath,
			"string_field_count":   len(sidecarMeta.StringFields),
			"numeric_field_count":  len(sidecarMeta.NumericFields),
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

	pngFields, err := parsePNGTextChunks(s.reader, absPath)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"relative_path": relPath,
			"error":         err.Error(),
		}).Error("failed to parse PNG metadata")
		return nil, fmt.Errorf("parsing PNG metadata: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"relative_path":  relPath,
		"metadata_count": len(pngFields),
	}).Debug("PNG metadata extracted")

	return &model.ImageMetadataValues{
		StringFields:  pngFields,
		NumericFields: map[string]float64{},
	}, nil
}

// numericSidecarFields is the set of sidecar JSON keys that are treated as
// numeric (float64) values. All other keys are treated as strings.
var numericSidecarFields = map[string]bool{
	"seed":  true,
	"steps": true,
	"cfg":   true,
}

// parseSidecarJSON reads a JSON sidecar file and returns its contents with
// typed fields. Known numeric fields (seed, steps, cfg) are placed in
// NumericFields as float64 values; all other fields are placed in StringFields.
// Returns os.ErrNotExist (wrapped) when the file does not exist.
func parseSidecarJSON(reader ImageMetadataReader, path string) (*model.ImageMetadataValues, error) {
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

	result := &model.ImageMetadataValues{
		StringFields:  make(map[string]string),
		NumericFields: make(map[string]float64),
	}

	for k, v := range raw {
		if numericSidecarFields[k] {
			// Numeric field: JSON numbers decode as float64 in Go
			switch val := v.(type) {
			case float64:
				result.NumericFields[k] = val
			case nil:
				// omit nil numeric fields
			default:
				// Non-numeric value in a numeric slot: best-effort as string
				b, err := json.Marshal(val)
				if err != nil {
					result.StringFields[k] = fmt.Sprintf("%v", val)
				} else {
					result.StringFields[k] = string(b)
				}
			}
		} else {
			// String field
			switch val := v.(type) {
			case string:
				result.StringFields[k] = val
			case nil:
				result.StringFields[k] = ""
			default:
				// Nested objects, booleans, unexpected numbers — marshal to compact JSON
				b, err := json.Marshal(val)
				if err != nil {
					result.StringFields[k] = fmt.Sprintf("%v", val)
				} else {
					result.StringFields[k] = string(b)
				}
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
