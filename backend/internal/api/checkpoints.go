package api

import (
	"context"
	"fmt"
	"strings"

	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/checkpoints"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
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
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid filename") {
			return nil, gencheckpoints.MakeInvalidFilename(fmt.Errorf("invalid filename: %s", p.Filename))
		}
		if strings.Contains(errMsg, "not found") {
			return nil, gencheckpoints.MakeNotFound(fmt.Errorf("checkpoint file not found: %s", p.Filename))
		}
		return nil, gencheckpoints.MakeNotFound(fmt.Errorf("reading checkpoint metadata: %w", err))
	}

	if metadata == nil {
		metadata = map[string]string{}
	}

	return &gencheckpoints.CheckpointMetadataResponse{
		Metadata: metadata,
	}, nil
}
