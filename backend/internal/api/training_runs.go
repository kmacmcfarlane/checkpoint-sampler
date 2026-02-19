package api

import (
	"context"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"

	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/training_runs"
)

// TrainingRunsService implements the generated training_runs service interface.
type TrainingRunsService struct {
	trainingRuns []model.TrainingRunConfig
}

// NewTrainingRunsService returns a new TrainingRunsService.
func NewTrainingRunsService(trainingRuns []model.TrainingRunConfig) *TrainingRunsService {
	return &TrainingRunsService{trainingRuns: trainingRuns}
}

// List returns all configured training runs.
func (s *TrainingRunsService) List(ctx context.Context) ([]*gentrainingruns.TrainingRunResponse, error) {
	result := make([]*gentrainingruns.TrainingRunResponse, len(s.trainingRuns))
	for i, tr := range s.trainingRuns {
		dims := make([]*gentrainingruns.DimensionConfigResponse, len(tr.Dimensions))
		for j, d := range tr.Dimensions {
			dims[j] = &gentrainingruns.DimensionConfigResponse{
				Name:    d.Name,
				Type:    string(d.Type),
				Pattern: d.Pattern.String(),
			}
		}
		result[i] = &gentrainingruns.TrainingRunResponse{
			ID:         i,
			Name:       tr.Name,
			Pattern:    tr.Pattern.String(),
			Dimensions: dims,
		}
	}
	return result, nil
}
