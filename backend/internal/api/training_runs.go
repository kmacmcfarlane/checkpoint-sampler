package api

import (
	"context"
	"fmt"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"

	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/training_runs"
)

// TrainingRunsService implements the generated training_runs service interface.
type TrainingRunsService struct {
	discovery *service.DiscoveryService
	scanner   *service.Scanner
}

// NewTrainingRunsService returns a new TrainingRunsService.
func NewTrainingRunsService(discovery *service.DiscoveryService, scanner *service.Scanner) *TrainingRunsService {
	return &TrainingRunsService{discovery: discovery, scanner: scanner}
}

// List returns auto-discovered training runs, optionally filtered by has_samples.
func (s *TrainingRunsService) List(ctx context.Context, p *gentrainingruns.ListPayload) ([]*gentrainingruns.TrainingRunResponse, error) {
	runs, err := s.discovery.Discover()
	if err != nil {
		return nil, gentrainingruns.MakeDiscoveryFailed(fmt.Errorf("discovering training runs: %w", err))
	}

	var result []*gentrainingruns.TrainingRunResponse
	for i, tr := range runs {
		if p.HasSamples && !tr.HasSamples {
			continue
		}

		checkpoints := make([]*gentrainingruns.CheckpointResponse, len(tr.Checkpoints))
		for j, cp := range tr.Checkpoints {
			checkpoints[j] = &gentrainingruns.CheckpointResponse{
				Filename:   cp.Filename,
				StepNumber: cp.StepNumber,
				HasSamples: cp.HasSamples,
			}
		}

		result = append(result, &gentrainingruns.TrainingRunResponse{
			ID:              i,
			Name:            tr.Name,
			CheckpointCount: len(tr.Checkpoints),
			HasSamples:      tr.HasSamples,
			Checkpoints:     checkpoints,
		})
	}

	if result == nil {
		result = []*gentrainingruns.TrainingRunResponse{}
	}
	return result, nil
}

// Scan scans a training run's sample directories and returns image metadata with
// discovered dimensions.
func (s *TrainingRunsService) Scan(ctx context.Context, p *gentrainingruns.ScanPayload) (*gentrainingruns.ScanResultResponse, error) {
	runs, err := s.discovery.Discover()
	if err != nil {
		return nil, gentrainingruns.MakeScanFailed(fmt.Errorf("discovering training runs: %w", err))
	}

	if p.ID < 0 || p.ID >= len(runs) {
		return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
	}

	tr := runs[p.ID]
	scanResult, err := s.scanner.ScanTrainingRun(tr)
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
