package api

import (
	"context"
	"fmt"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"

	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/training_runs"
)

// TrainingRunsService implements the generated training_runs service interface.
type TrainingRunsService struct {
	trainingRuns []model.TrainingRunConfig
	scanner      *service.Scanner
}

// NewTrainingRunsService returns a new TrainingRunsService.
func NewTrainingRunsService(trainingRuns []model.TrainingRunConfig, scanner *service.Scanner) *TrainingRunsService {
	return &TrainingRunsService{trainingRuns: trainingRuns, scanner: scanner}
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

// Scan scans a training run's directories and returns image metadata with
// discovered dimensions.
func (s *TrainingRunsService) Scan(ctx context.Context, p *gentrainingruns.ScanPayload) (*gentrainingruns.ScanResultResponse, error) {
	if p.ID < 0 || p.ID >= len(s.trainingRuns) {
		return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
	}

	tr := s.trainingRuns[p.ID]
	scanResult, err := s.scanner.Scan(tr)
	if err != nil {
		return nil, gentrainingruns.MakeScanFailed(fmt.Errorf("scanning training run %q: %w", tr.Name, err))
	}

	// Map model types to API response types
	images := make([]*gentrainingruns.ImageResponse, len(scanResult.Images))
	for i, img := range scanResult.Images {
		images[i] = &gentrainingruns.ImageResponse{
			RelativePath: img.RelativePath,
			Dimensions:   img.Dimensions,
		}
	}

	dimensions := make([]*gentrainingruns.DimensionResponse, len(scanResult.Dimensions))
	for i, dim := range scanResult.Dimensions {
		dimensions[i] = &gentrainingruns.DimensionResponse{
			Name:   dim.Name,
			Type:   string(dim.Type),
			Values: dim.Values,
		}
	}

	return &gentrainingruns.ScanResultResponse{
		Images:     images,
		Dimensions: dimensions,
	}, nil
}
