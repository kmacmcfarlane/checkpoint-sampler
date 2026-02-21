package service

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"path/filepath"
	"strings"
)

// ImageMetadataReader defines filesystem operations needed to read image files.
type ImageMetadataReader interface {
	OpenFile(path string) (io.ReadCloser, error)
}

// ImageMetadataService parses PNG tEXt chunks to extract embedded metadata.
type ImageMetadataService struct {
	reader    ImageMetadataReader
	sampleDir string
}

// NewImageMetadataService creates an image metadata service.
func NewImageMetadataService(reader ImageMetadataReader, sampleDir string) *ImageMetadataService {
	return &ImageMetadataService{
		reader:    reader,
		sampleDir: sampleDir,
	}
}

// GetMetadata reads the PNG file at the given relative path (within sampleDir)
// and extracts tEXt chunk metadata. Returns an empty map (not error) when no
// metadata is embedded.
func (s *ImageMetadataService) GetMetadata(relPath string) (map[string]string, error) {
	if !isPathSafe(relPath) {
		return nil, fmt.Errorf("invalid path: %q", relPath)
	}

	absPath := filepath.Join(s.sampleDir, filepath.FromSlash(relPath))

	// Double-check resolved path stays within sampleDir
	cleanRoot := filepath.Clean(s.sampleDir)
	cleanPath := filepath.Clean(absPath)
	if !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) && cleanPath != cleanRoot {
		return nil, fmt.Errorf("invalid path: %q", relPath)
	}

	metadata, err := parsePNGTextChunks(s.reader, absPath)
	if err != nil {
		return nil, fmt.Errorf("parsing PNG metadata: %w", err)
	}

	return metadata, nil
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
