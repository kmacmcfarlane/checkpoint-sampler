package api

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
	"github.com/sirupsen/logrus"
)

// ImagesService implements the generated images service interface.
type ImagesService struct {
	sampleDir   string
	metadataSvc *service.ImageMetadataService
	logger      *logrus.Entry
}

// NewImagesService returns a new ImagesService.
func NewImagesService(sampleDir string, metadataSvc *service.ImageMetadataService, logger *logrus.Logger) *ImagesService {
	return &ImagesService{
		sampleDir:   sampleDir,
		metadataSvc: metadataSvc,
		logger:      logger.WithField("component", "images_service"),
	}
}

// Download serves an image file from the sample directory with path traversal protection
// and immutable cache headers. Returns the file as an io.ReadCloser that Goa will stream.
func (s *ImagesService) Download(ctx context.Context, p *genimages.DownloadPayload) (*genimages.ImageDownloadResult, io.ReadCloser, error) {
	s.logger.WithField("filepath", p.Filepath).Debug("download request")

	// Validate the path doesn't contain traversal components
	if !isPathSafe(p.Filepath) {
		s.logger.WithField("filepath", p.Filepath).Warn("invalid path rejected")
		return nil, nil, genimages.MakeBadRequest(fmt.Errorf("invalid file path"))
	}

	absPath := filepath.Join(s.sampleDir, filepath.FromSlash(p.Filepath))

	// Double-check the resolved path is within sampleDir
	cleanRoot := filepath.Clean(s.sampleDir)
	cleanPath := filepath.Clean(absPath)
	if !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) && cleanPath != cleanRoot {
		s.logger.WithField("filepath", p.Filepath).Warn("path traversal attempt rejected")
		return nil, nil, genimages.MakeBadRequest(fmt.Errorf("invalid file path"))
	}

	// Check file exists and is a regular file
	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		s.logger.WithFields(logrus.Fields{
			"filepath": p.Filepath,
			"error":    err,
		}).Debug("image not found")
		return nil, nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	// Open the file for streaming
	file, err := os.Open(absPath)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"filepath": p.Filepath,
			"error":    err.Error(),
		}).Error("error opening image file")
		return nil, nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	// Detect content type by reading the first 512 bytes
	buffer := make([]byte, 512)
	n, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		file.Close()
		s.logger.WithFields(logrus.Fields{
			"filepath": p.Filepath,
			"error":    err.Error(),
		}).Error("error reading image file for content type detection")
		return nil, nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	contentType := http.DetectContentType(buffer[:n])

	// Seek back to the start of the file
	if _, err := file.Seek(0, 0); err != nil {
		file.Close()
		s.logger.WithFields(logrus.Fields{
			"filepath": p.Filepath,
			"error":    err.Error(),
		}).Error("error seeking to start of image file")
		return nil, nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	result := &genimages.ImageDownloadResult{
		ContentType:   contentType,
		ContentLength: info.Size(),
		CacheControl:  "max-age=31536000, immutable",
	}

	s.logger.WithFields(logrus.Fields{
		"filepath":     p.Filepath,
		"content_type": contentType,
		"size":         info.Size(),
	}).Debug("serving image")

	return result, file, nil
}

// Metadata returns PNG tEXt chunk metadata from an image file.
func (s *ImagesService) Metadata(ctx context.Context, p *genimages.MetadataPayload) (*genimages.ImageMetadataResponse, error) {
	s.logger.WithField("filepath", p.Filepath).Debug("metadata request")

	metadata, err := s.metadataSvc.GetMetadata(p.Filepath)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid path") {
			return nil, genimages.MakeBadRequest(fmt.Errorf("invalid file path"))
		}
		if strings.Contains(errMsg, "opening file") {
			return nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
		}
		return nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	if metadata == nil {
		metadata = map[string]string{}
	}

	return &genimages.ImageMetadataResponse{
		Metadata: metadata,
	}, nil
}

// isPathSafe checks that a relative path does not contain path traversal components.
func isPathSafe(p string) bool {
	// Reject empty paths
	if p == "" {
		return false
	}

	// Reject absolute paths
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") {
		return false
	}

	// Check each component
	parts := strings.Split(filepath.ToSlash(p), "/")
	for _, part := range parts {
		if part == ".." || part == "." {
			return false
		}
	}

	return true
}
