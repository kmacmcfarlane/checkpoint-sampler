package api

import (
	"context"
	"database/sql"
	"fmt"

	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// StudyGetter defines the interface for fetching a study by ID, used by validation.
type StudyGetter interface {
	GetStudy(id string) (model.Study, error)
}

// TrainingRunsService implements the generated training_runs service interface.
type TrainingRunsService struct {
	viewerDiscovery      *service.ViewerDiscoveryService
	checkpointDiscovery  *service.DiscoveryService
	scanner              *service.Scanner
	validator            *service.ValidationService
	watcher              *service.Watcher
	studyGetter          StudyGetter
}

// NewTrainingRunsService returns a new TrainingRunsService.
func NewTrainingRunsService(viewerDiscovery *service.ViewerDiscoveryService, checkpointDiscovery *service.DiscoveryService, scanner *service.Scanner, validator *service.ValidationService, watcher *service.Watcher, studyGetter StudyGetter) *TrainingRunsService {
	return &TrainingRunsService{viewerDiscovery: viewerDiscovery, checkpointDiscovery: checkpointDiscovery, scanner: scanner, validator: validator, watcher: watcher, studyGetter: studyGetter}
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
// When study_id is provided, uses the study's images-per-checkpoint as the expected count.
// Otherwise falls back to the max-file-count heuristic.
func (s *TrainingRunsService) Validate(ctx context.Context, p *gentrainingruns.ValidatePayload) (*gentrainingruns.ValidationResultResponse, error) {
	var result *model.ValidationResult

	if p.StudyID != nil && *p.StudyID != "" && s.studyGetter != nil {
		// Study-aware validation path: discover training runs using the checkpoint
		// source (same source the frontend uses for the Generate Samples dialog).
		// This ensures the training run ID matches what the frontend sent.
		// The viewer-discovery source cannot be used here because:
		//   1. Before generation it returns no runs (ID mismatch → not_found).
		//   2. After generation the run name embeds the study output dir
		//      (e.g. "my-model/study-abc/my-model") and appending study.ID
		//      would produce an incorrect double-nested path.
		runs, err := s.checkpointDiscovery.Discover()
		if err != nil {
			return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("discovering checkpoint training runs: %w", err))
		}

		if p.ID < 0 || p.ID >= len(runs) {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
		}

		tr := runs[p.ID]

		study, err := s.studyGetter.GetStudy(*p.StudyID)
		if err == sql.ErrNoRows {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("study %s not found", *p.StudyID))
		}
		if err != nil {
			return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("fetching study: %w", err))
		}
		// Build the scoped study output dir: {trainingRunName}/{studyID}
		// This matches the directory written by the job executor.
		scopedStudyDir := tr.Name + "/" + study.ID
		result, err = s.validator.ValidateTrainingRunWithStudy(tr, study, scopedStudyDir)
		if err != nil {
			return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("validating training run %q with study: %w", tr.Name, err))
		}
	} else {
		// Legacy validation (no study context): discover from viewer source and
		// use the max-file-count heuristic.
		runs, err := s.viewerDiscovery.DiscoverViewable()
		if err != nil {
			return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("discovering viewable training runs: %w", err))
		}

		if p.ID < 0 || p.ID >= len(runs) {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
		}

		tr := runs[p.ID]
		studyName := service.StudyNameForRun(tr.Name)
		result, err = s.validator.ValidateTrainingRun(tr, studyName)
		if err != nil {
			return nil, gentrainingruns.MakeValidationFailed(fmt.Errorf("validating training run %q: %w", tr.Name, err))
		}
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
		Checkpoints:           checkpoints,
		ExpectedPerCheckpoint: result.ExpectedPerCheckpoint,
		TotalExpected:         result.TotalExpected,
		TotalVerified:         result.TotalVerified,
		TotalActual:           result.TotalActual,
		TotalMissing:          result.TotalMissing,
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
			RelativePath:  img.RelativePath,
			Dimensions:    img.Dimensions,
			ThumbnailPath: img.ThumbnailPath,
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
