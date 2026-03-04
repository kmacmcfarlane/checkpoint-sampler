package api

import (
	"context"
	"fmt"

	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// TrainingRunsService implements the generated training_runs service interface.
type TrainingRunsService struct {
	viewerDiscovery      *service.ViewerDiscoveryService
	checkpointDiscovery  *service.DiscoveryService
	scanner              *service.Scanner
	validator            *service.ValidationService
	watcher              *service.Watcher
}

// NewTrainingRunsService returns a new TrainingRunsService.
func NewTrainingRunsService(viewerDiscovery *service.ViewerDiscoveryService, checkpointDiscovery *service.DiscoveryService, scanner *service.Scanner, validator *service.ValidationService, watcher *service.Watcher) *TrainingRunsService {
	return &TrainingRunsService{viewerDiscovery: viewerDiscovery, checkpointDiscovery: checkpointDiscovery, scanner: scanner, validator: validator, watcher: watcher}
}

// List returns training runs discovered from either sample output directories
// (source=samples, the default for the viewer) or checkpoint files
// (source=checkpoints, for the Generate Samples dialog).
func (s *TrainingRunsService) List(ctx context.Context, p *gentrainingruns.ListPayload) ([]*gentrainingruns.TrainingRunResponse, error) {
	var runs []model.TrainingRun
	var err error

	if p.Source == "checkpoints" {
		runs, err = s.checkpointDiscovery.Discover()
		if err != nil {
			return nil, gentrainingruns.MakeDiscoveryFailed(fmt.Errorf("discovering checkpoint training runs: %w", err))
		}
	} else {
		runs, err = s.viewerDiscovery.DiscoverViewable()
		if err != nil {
			return nil, gentrainingruns.MakeDiscoveryFailed(fmt.Errorf("discovering viewable training runs: %w", err))
		}
	}

	var result []*gentrainingruns.TrainingRunResponse
	for i, tr := range runs {
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

// Validate checks the completeness of sample images for a training run.
// It counts PNG files per checkpoint and compares against the maximum count.
func (s *TrainingRunsService) Validate(ctx context.Context, p *gentrainingruns.ValidatePayload) (*gentrainingruns.ValidationResultResponse, error) {
	runs, err := s.viewerDiscovery.DiscoverViewable()
	if err != nil {
		return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("discovering viewable training runs: %w", err))
	}

	if p.ID < 0 || p.ID >= len(runs) {
		return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
	}

	tr := runs[p.ID]
	studyName := service.StudyNameForRun(tr.Name)

	result, err := s.validator.ValidateTrainingRun(tr, studyName)
	if err != nil {
		return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("validating training run %q: %w", tr.Name, err))
	}

	// Map model types to API response types
	checkpoints := make([]*gentrainingruns.CheckpointCompletenessResponse, len(result.Checkpoints))
	for i, cp := range result.Checkpoints {
		checkpoints[i] = &gentrainingruns.CheckpointCompletenessResponse{
			Checkpoint: cp.Checkpoint,
			Expected:   cp.Expected,
			Verified:   cp.Verified,
			Missing:    cp.Missing,
		}
	}

	return &gentrainingruns.ValidationResultResponse{
		Checkpoints: checkpoints,
	}, nil
}

// Scan scans a training run's sample directories and returns image metadata with
// discovered dimensions. The study name is auto-derived from the training run name
// (viewer-discovered runs include the study prefix in their name).
func (s *TrainingRunsService) Scan(ctx context.Context, p *gentrainingruns.ScanPayload) (*gentrainingruns.ScanResultResponse, error) {
	runs, err := s.viewerDiscovery.DiscoverViewable()
	if err != nil {
		return nil, gentrainingruns.MakeScanFailed(fmt.Errorf("discovering viewable training runs: %w", err))
	}

	if p.ID < 0 || p.ID >= len(runs) {
		return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
	}

	tr := runs[p.ID]

	// Derive the study name from the training run name. For viewer-discovered runs,
	// the study prefix is embedded in the run name (e.g., "study_name/model_base").
	// Use the explicit study_name parameter if provided; otherwise auto-derive.
	studyName := p.StudyName
	if studyName == "" {
		studyName = service.StudyNameForRun(tr.Name)
	}

	scanResult, err := s.scanner.ScanTrainingRun(tr, studyName)
	if err != nil {
		return nil, gentrainingruns.MakeScanFailed(fmt.Errorf("scanning training run %q: %w", tr.Name, err))
	}

	// Start watching directories for this training run (best-effort)
	if s.watcher != nil {
		_ = s.watcher.WatchTrainingRun(tr)
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
