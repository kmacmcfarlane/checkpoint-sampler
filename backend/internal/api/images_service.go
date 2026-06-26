package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"

	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
	"github.com/sirupsen/logrus"
)

// ImageFileResolver resolves a client-supplied relative image path against a
// configured sample root, performing path-traversal validation and opening the
// resolved file for streaming. This is a consumer-defined interface
// (DEVELOPMENT_PRACTICES §3.3) implemented by the store layer, keeping all
// filesystem access and the path-traversal security boundary out of the
// transport adapter. Resolution failures are classified via the store sentinel
// errors store.ErrInvalidImagePath and store.ErrImageNotFound.
type ImageFileResolver interface {
	OpenImageFile(sampleRoot string, relPath string) (*store.ImageFile, error)
}

// ImagesService implements the generated images service interface.
type ImagesService struct {
	sampleDir   string
	resolver    ImageFileResolver
	metadataSvc *service.ImageMetadataService
	logger      *logrus.Entry
}

// NewImagesService returns a new ImagesService.
func NewImagesService(sampleDir string, resolver ImageFileResolver, metadataSvc *service.ImageMetadataService, logger *logrus.Logger) *ImagesService {
	return &ImagesService{
		sampleDir:   sampleDir,
		resolver:    resolver,
		metadataSvc: metadataSvc,
		logger:      logger.WithField("component", "images_service"),
	}
}

// Download serves an image file from the sample directory with path traversal protection
// and immutable cache headers. Returns the file as an io.ReadCloser that Goa will stream.
func (s *ImagesService) Download(ctx context.Context, p *genimages.DownloadPayload) (*genimages.ImageDownloadResult, io.ReadCloser, error) {
	s.logger.WithField("filepath", p.Filepath).Debug("download request")

	// Resolve and open the file behind the store-layer seam. All path-traversal
	// validation and filesystem access lives there; this handler stays a thin
	// streaming adapter. Failures are classified via the store sentinel errors.
	file, err := s.resolver.OpenImageFile(s.sampleDir, p.Filepath)
	if err != nil {
		if errors.Is(err, store.ErrInvalidImagePath) {
			s.logger.WithField("filepath", p.Filepath).Warn("invalid path rejected")
			return nil, nil, genimages.MakeInvalidPayload(fmt.Errorf("invalid file path"))
		}
		s.logger.WithFields(logrus.Fields{
			"filepath": p.Filepath,
			"error":    err.Error(),
		}).Debug("image not found")
		return nil, nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	// Detect content type by reading the first 512 bytes, then seek back to the
	// start of the file so the full contents stream to the client.
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
		ContentLength: file.Size,
		CacheControl:  "max-age=31536000, immutable",
	}

	s.logger.WithFields(logrus.Fields{
		"filepath":     p.Filepath,
		"content_type": contentType,
		"size":         file.Size,
	}).Debug("serving image")

	return result, file, nil
}

// Metadata returns image metadata from a JSON sidecar or PNG tEXt chunks.
// Numeric fields (seed, steps, cfg) are returned in NumericMetadata; all
// other fields are returned in StringMetadata.
func (s *ImagesService) Metadata(ctx context.Context, p *genimages.MetadataPayload) (*genimages.ImageMetadataResponse, error) {
	s.logger.WithField("filepath", p.Filepath).Debug("metadata request")

	values, err := s.metadataSvc.GetMetadata(p.Filepath)
	if err != nil {
		// Classify via sentinel errors (errors.Is) rather than substring matching.
		// Client-facing messages are generic and never include a server path.
		if errors.Is(err, service.ErrInvalidPath) {
			s.logger.WithFields(logrus.Fields{
				"filepath": p.Filepath,
				"error":    err.Error(),
			}).Debug("invalid image metadata path rejected")
			return nil, genimages.MakeInvalidPayload(fmt.Errorf("invalid file path"))
		}
		s.logger.WithFields(logrus.Fields{
			"filepath": p.Filepath,
			"error":    err.Error(),
		}).Debug("image metadata not found")
		return nil, genimages.MakeNotFound(fmt.Errorf("image not found"))
	}

	stringMeta := values.StringFields
	if stringMeta == nil {
		stringMeta = map[string]string{}
	}
	numericMeta := values.NumericFields
	if numericMeta == nil {
		numericMeta = map[string]float64{}
	}

	return &genimages.ImageMetadataResponse{
		StringMetadata:  stringMeta,
		NumericMetadata: numericMeta,
	}, nil
}
