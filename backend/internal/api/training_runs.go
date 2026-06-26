package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// StudyGetter defines the interface for fetching a study by ID, used by validation.
type StudyGetter interface {
	GetStudy(id string) (model.Study, error)
}

// TrainingRunsService implements the generated training_runs service interface.
type TrainingRunsService struct {
	viewerDiscovery     *service.ViewerDiscoveryService
	checkpointDiscovery *service.DiscoveryService
	scanner             *service.Scanner
	validator           *service.ValidationService
	watcher             *service.Watcher
	studyGetter         StudyGetter
	fsState             *service.FSState
}

// NewTrainingRunsService returns a new TrainingRunsService.
func NewTrainingRunsService(viewerDiscovery *service.ViewerDiscoveryService, checkpointDiscovery *service.DiscoveryService, scanner *service.Scanner, validator *service.ValidationService, watcher *service.Watcher, studyGetter StudyGetter) *TrainingRunsService {
	return &TrainingRunsService{viewerDiscovery: viewerDiscovery, checkpointDiscovery: checkpointDiscovery, scanner: scanner, validator: validator, watcher: watcher, studyGetter: studyGetter}
}

// SetFSState configures the service to serve training run lists from the
// in-memory FSState snapshot instead of re-scanning the filesystem on each request.
func (s *TrainingRunsService) SetFSState(state *service.FSState) {
	s.fsState = state
}

// List returns training runs discovered from either sample output directories
// (source=samples, the default for the viewer) or checkpoint files
// (source=checkpoints, for the Generate Samples dialog).
// When an FSState snapshot is configured, results are served from the in-memory
// cache (populated at startup, updated reactively via fsnotify).
func (s *TrainingRunsService) List(ctx context.Context, p *gentrainingruns.ListPayload) ([]*gentrainingruns.TrainingRunResponse, error) {
	var runs []model.TrainingRun
	var err error

	// B-142: When refresh is requested, force a fresh filesystem rescan into the
	// FSState cache before reading. This bypasses the stale in-memory snapshot that
	// fsnotify cannot keep current on NFS mounts (events for files added by other
	// hosts do not fire). After Populate(), the reads below return up-to-date data.
	if p.Refresh && s.fsState != nil {
		if err = s.fsState.Populate(); err != nil {
			return nil, gentrainingruns.MakeInternalError(fmt.Errorf("refreshing filesystem state: %w", err))
		}
	}

	if p.Source == "checkpoints" {
		if s.fsState != nil {
			runs = s.fsState.CheckpointRuns()
		} else {
			runs, err = s.checkpointDiscovery.Discover()
			if err != nil {
				return nil, gentrainingruns.MakeInternalError(fmt.Errorf("discovering checkpoint training runs: %w", err))
			}
		}
	} else {
		if s.fsState != nil {
			runs = s.fsState.ViewableRuns()
		} else {
			runs, err = s.viewerDiscovery.DiscoverViewable()
			if err != nil {
				return nil, gentrainingruns.MakeInternalError(fmt.Errorf("discovering viewable training runs: %w", err))
			}
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

		// Default kind to "checkpoint" for viewer-discovered runs that lack explicit kind.
		kind := string(tr.Kind)
		if kind == "" {
			kind = string(model.TrainingRunKindCheckpoint)
		}

		resp := &gentrainingruns.TrainingRunResponse{
			ID:              i,
			Name:            tr.Name,
			Kind:            kind,
			CheckpointCount: len(tr.Checkpoints),
			HasSamples:      tr.HasSamples,
			Checkpoints:     checkpoints,
		}
		if tr.TrainingRunDir != "" {
			resp.TrainingRunDir = &tr.TrainingRunDir
		}
		if tr.StudyLabel != "" {
			resp.StudyLabel = &tr.StudyLabel
		}
		if tr.StudyOutputDir != "" {
			resp.StudyOutputDir = &tr.StudyOutputDir
		}
		result = append(result, resp)
	}

	if result == nil {
		result = []*gentrainingruns.TrainingRunResponse{}
	}
	return result, nil
}

// isManifestNotFound returns true if the error indicates a missing manifest file.
// B-132: Used to decide whether to fall back from manifest-based to count-based validation.
func isManifestNotFound(err error) bool {
	return errors.Is(err, service.ErrManifestNotFound)
}

// Validate checks the completeness of sample images for a training run.
//
// B-132: Validation now prefers manifest-based verification which checks each
// expected sample by filename, verifies per-sample sidecar JSON params against
// the manifest, and flags foreign (unexpected) files. This replaces the old
// count-only approach that could not detect modified filenames or param mismatches.
//
// When study_id is provided:
//  1. Try manifest-based validation (ValidateTrainingRunWithManifest) first.
//  2. Fall back to study-config-based validation (ValidateTrainingRunWithStudy)
//     only when no manifest.json exists yet (pre-generation).
//
// When no study_id is provided (viewer path):
//  1. Try manifest-based validation using the study output dir derived from the run name.
//  2. Fall back to the legacy max-file-count heuristic (ValidateTrainingRun).
func (s *TrainingRunsService) Validate(ctx context.Context, p *gentrainingruns.ValidatePayload) (*gentrainingruns.ValidationResultResponse, error) {
	var result *model.ValidationResult

	if p.StudyID != nil && *p.StudyID != "" && s.studyGetter != nil {
		// Study-aware validation path: discover training runs using the checkpoint
		// source (same source the frontend uses for the Generate Samples dialog).
		var runs []model.TrainingRun
		var err error
		if s.fsState != nil {
			runs = s.fsState.CheckpointRuns()
		} else {
			runs, err = s.checkpointDiscovery.Discover()
			if err != nil {
				return nil, gentrainingruns.MakeInternalError(fmt.Errorf("discovering checkpoint training runs: %w", err))
			}
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
			return nil, gentrainingruns.MakeInternalError(fmt.Errorf("fetching study: %w", err))
		}
		// Build the scoped study output dir: {sanitized_trainingRunName}/{studyName}
		// Training run names can contain slashes (e.g. "qwen/Qwen2-VL"), so the name
		// must be sanitized to a single directory level before path construction.
		// This matches exactly what the job executor writes when saving sample images.
		scopedStudyDir := fileformat.SanitizeTrainingRunName(tr.Name) + "/" + study.Name

		// B-132: Prefer manifest-based validation (per-sample filename + param verification).
		// Fall back to study-config-based count validation only when no manifest exists.
		result, err = s.validator.ValidateTrainingRunWithManifest(tr, scopedStudyDir)
		if err != nil {
			// If the error indicates a missing manifest, fall back to study-based validation.
			// This happens before the first generation when no manifest.json exists yet.
			if isManifestNotFound(err) {
				result, err = s.validator.ValidateTrainingRunWithStudy(tr, study, scopedStudyDir)
				if err != nil {
					return nil, gentrainingruns.MakeInternalError(fmt.Errorf("validating training run %q with study: %w", tr.Name, err))
				}
			} else {
				return nil, gentrainingruns.MakeInternalError(fmt.Errorf("validating training run %q with manifest: %w", tr.Name, err))
			}
		}
	} else {
		// Viewer validation path (no study context from the caller).
		var runs []model.TrainingRun
		var err error
		if s.fsState != nil {
			runs = s.fsState.ViewableRuns()
		} else {
			runs, err = s.viewerDiscovery.DiscoverViewable()
			if err != nil {
				return nil, gentrainingruns.MakeInternalError(fmt.Errorf("discovering viewable training runs: %w", err))
			}
		}

		if p.ID < 0 || p.ID >= len(runs) {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %d not found", p.ID))
		}

		tr := runs[p.ID]
		var studyName string
		if p.StudyOutputDir != nil && *p.StudyOutputDir != "" {
			studyName = *p.StudyOutputDir
		} else {
			studyName = service.StudyNameForRun(tr.Name)
		}

		// B-132: Prefer manifest-based validation when a study output dir is available.
		// Fall back to the legacy count heuristic for pre-generation or non-study runs.
		if studyName != "" {
			result, err = s.validator.ValidateTrainingRunWithManifest(tr, studyName)
			if err != nil {
				if isManifestNotFound(err) {
					// No manifest yet — fall back to legacy count heuristic.
					result, err = s.validator.ValidateTrainingRun(tr, studyName)
					if err != nil {
						return nil, gentrainingruns.MakeInternalError(fmt.Errorf("validating training run %q: %w", tr.Name, err))
					}
				} else {
					return nil, gentrainingruns.MakeInternalError(fmt.Errorf("validating training run %q with manifest: %w", tr.Name, err))
				}
			}
		} else {
			// No study context at all — legacy root-level validation.
			result, err = s.validator.ValidateTrainingRun(tr, studyName)
			if err != nil {
				return nil, gentrainingruns.MakeInternalError(fmt.Errorf("validating training run %q: %w", tr.Name, err))
			}
		}
	}

	// Map model types to API response types
	checkpoints := make([]*gentrainingruns.CheckpointCompletenessResponse, len(result.Checkpoints))
	for i, cp := range result.Checkpoints {
		checkpoints[i] = &gentrainingruns.CheckpointCompletenessResponse{
			Checkpoint:    cp.Checkpoint,
			Expected:      cp.Expected,
			Verified:      cp.Verified,
			Missing:       cp.Missing,
			Extra:         cp.Extra,
			InvalidParams: cp.InvalidParams,
		}
	}

	return &gentrainingruns.ValidationResultResponse{
		Checkpoints:           checkpoints,
		ExpectedPerCheckpoint: result.ExpectedPerCheckpoint,
		TotalExpected:         result.TotalExpected,
		TotalVerified:         result.TotalVerified,
		TotalActual:           result.TotalActual,
		TotalMissing:          result.TotalMissing,
		TotalExtra:            result.TotalExtra,
		TotalInvalidParams:    result.TotalInvalidParams,
	}, nil
}

// Scan scans a training run's sample directories and returns image metadata with
// discovered dimensions. The study name is auto-derived from the training run name
// (viewer-discovered runs include the study prefix in their name).
func (s *TrainingRunsService) Scan(ctx context.Context, p *gentrainingruns.ScanPayload) (*gentrainingruns.ScanResultResponse, error) {
	var runs []model.TrainingRun
	var err error
	if s.fsState != nil {
		runs = s.fsState.ViewableRuns()
	} else {
		runs, err = s.viewerDiscovery.DiscoverViewable()
		if err != nil {
			return nil, gentrainingruns.MakeInternalError(fmt.Errorf("discovering viewable training runs: %w", err))
		}
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
		return nil, gentrainingruns.MakeInternalError(fmt.Errorf("scanning training run %q: %w", tr.Name, err))
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
