package api

import (
	"context"
	"errors"
	"fmt"

	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// CheckpointsService implements the generated checkpoints service interface.
type CheckpointsService struct {
	metadataSvc *service.CheckpointMetadataService
}

// NewCheckpointsService returns a new CheckpointsService.
func NewCheckpointsService(metadataSvc *service.CheckpointMetadataService) *CheckpointsService {
	return &CheckpointsService{metadataSvc: metadataSvc}
}

// Metadata returns training metadata (ss_* fields) from a safetensors checkpoint file header.
func (s *CheckpointsService) Metadata(ctx context.Context, p *gencheckpoints.MetadataPayload) (*gencheckpoints.CheckpointMetadataResponse, error) {
	metadata, err := s.metadataSvc.GetMetadata(p.Filename)
	if err != nil {
		// Classify via sentinel errors (errors.Is) rather than substring matching.
		// Client-facing messages reference only the requested filename, never an
		// absolute server path.
		if errors.Is(err, service.ErrInvalidFilename) {
			return nil, gencheckpoints.MakeInvalidPayload(fmt.Errorf("invalid filename: %s", p.Filename))
		}
		if errors.Is(err, service.ErrNotFound) {
			return nil, gencheckpoints.MakeNotFound(fmt.Errorf("checkpoint file not found: %s", p.Filename))
		}
		return nil, gencheckpoints.MakeNotFound(fmt.Errorf("checkpoint file not found: %s", p.Filename))
	}

	if metadata == nil {
		metadata = map[string]string{}
	}

	return &gencheckpoints.CheckpointMetadataResponse{
		Metadata: metadata,
	}, nil
}
