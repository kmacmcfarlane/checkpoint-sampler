package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

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
	for _, tr := range runs {
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
			ID:              service.TrainingRunID(tr),
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
// B-132: Validation prefers manifest-based verification which checks each
// expected sample by filename, verifies per-sample sidecar JSON params against
// the manifest, and flags foreign (unexpected) files. This replaces the old
// count-only approach that could not detect modified filenames or param mismatches.
//
// B-160: Both validation entry points converge on a single shared core
// (validateSampleSet) so they cannot diverge:
//
//   - Study-aware path (study_id, the Generate Samples dialog): the canonical
//     on-disk sample output dir is resolved via resolveStudyOutputDir (which
//     consults viewer discovery — the same source the slideout uses) instead of
//     naively reconstructing {sanitize(run)}/{study}. The naive path omitted the
//     {base_model} level that LoRA runs write into, so the manifest was not found
//     and validation reported 0/N while the slideout reported N/N.
//   - Viewer path (study_output_dir, the left-panel "Validate" slideout): the
//     caller already supplies the run's real StudyOutputDir, which is passed
//     straight through to the same core.
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

		tr, ok := service.FindTrainingRunByID(runs, p.ID)
		if !ok {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %q not found", p.ID))
		}

		study, err := s.studyGetter.GetStudy(*p.StudyID)
		if err == sql.ErrNoRows {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("study %s not found", *p.StudyID))
		}
		if err != nil {
			return nil, gentrainingruns.MakeInternalError(fmt.Errorf("fetching study: %w", err))
		}

		// B-160: resolve the study's canonical on-disk output dir (the same value
		// the slideout passes) rather than reconstructing it from names, then run
		// the shared validation core.
		studyOutputDir := s.resolveStudyOutputDir(tr, study)
		result, err = s.validateSampleSet(tr, studyOutputDir, &study)
		if err != nil {
			return nil, gentrainingruns.MakeInternalError(err)
		}
	} else {
		// Viewer validation path: the caller supplies the run's real study output
		// dir (or none, for legacy root-level runs).
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

		tr, ok := service.FindTrainingRunByID(runs, p.ID)
		if !ok {
			return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %q not found", p.ID))
		}

		var studyOutputDir string
		if p.StudyOutputDir != nil && *p.StudyOutputDir != "" {
			studyOutputDir = *p.StudyOutputDir
		} else {
			studyOutputDir = service.StudyNameForRun(tr.Name)
		}

		result, err = s.validateSampleSet(tr, studyOutputDir, nil)
		if err != nil {
			return nil, gentrainingruns.MakeInternalError(err)
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

// resolveStudyOutputDir determines the canonical on-disk sample output directory
// for a training run + study. It consults viewer discovery — the same source the
// left-panel "Validate" slideout draws its StudyOutputDir from — so the dialog
// (study_id) and slideout (study_output_dir) validation paths resolve the
// identical directory and cannot diverge (B-160).
//
// The naive path {sanitize(run)}/{study} is correct for checkpoint runs but omits
// the {base_model} level that LoRA runs write into
// ({sanitize(run)}/{study}/{base_model}). Reconstructing from names alone yielded
// a directory with no manifest, which made the dialog report 0/N while the
// slideout (using the real StudyOutputDir) reported N/N.
//
// When no viewer run matches (e.g. no samples generated yet), it returns the
// naive path so pre-generation study-config validation still works.
func (s *TrainingRunsService) resolveStudyOutputDir(tr model.TrainingRun, study model.Study) string {
	naive := fileformat.SanitizeTrainingRunName(tr.Name) + "/" + study.Name

	var viewerRuns []model.TrainingRun
	if s.fsState != nil {
		viewerRuns = s.fsState.ViewableRuns()
	} else if s.viewerDiscovery != nil {
		discovered, err := s.viewerDiscovery.DiscoverViewable()
		if err != nil {
			// Viewer discovery failed — fall back to the naive path rather than
			// failing validation outright.
			return naive
		}
		viewerRuns = discovered
	}

	// Prefer an exact match (checkpoint layout: {run}/{study}); otherwise accept
	// the first prefix match (LoRA layout: {run}/{study}/{base_model}).
	prefix := naive + "/"
	prefixMatch := ""
	for _, vr := range viewerRuns {
		if vr.StudyOutputDir == naive {
			return vr.StudyOutputDir
		}
		if prefixMatch == "" && strings.HasPrefix(vr.StudyOutputDir, prefix) {
			prefixMatch = vr.StudyOutputDir
		}
	}
	if prefixMatch != "" {
		return prefixMatch
	}
	return naive
}

// validateSampleSet is the single "actual vs expected" core shared by both
// validation entry points (B-160). It prefers manifest-based validation
// (per-sample filename + sidecar param verification) for the given study output
// dir, falling back only when no manifest exists yet (pre-generation):
//   - to study-config count validation when a study is supplied (dialog path);
//   - to the legacy max-file-count heuristic otherwise (viewer path).
//
// Returned errors are already wrapped with context; callers map them to the
// transport error type.
func (s *TrainingRunsService) validateSampleSet(tr model.TrainingRun, studyOutputDir string, study *model.Study) (*model.ValidationResult, error) {
	result, err := s.validator.ValidateTrainingRunWithManifest(tr, studyOutputDir)
	if err == nil {
		return result, nil
	}
	if !isManifestNotFound(err) {
		return nil, fmt.Errorf("validating training run %q with manifest: %w", tr.Name, err)
	}

	// No manifest yet (pre-generation) — fall back.
	if study != nil {
		result, err = s.validator.ValidateTrainingRunWithStudy(tr, *study, studyOutputDir)
		if err != nil {
			return nil, fmt.Errorf("validating training run %q with study: %w", tr.Name, err)
		}
		return result, nil
	}
	result, err = s.validator.ValidateTrainingRun(tr, studyOutputDir)
	if err != nil {
		return nil, fmt.Errorf("validating training run %q: %w", tr.Name, err)
	}
	return result, nil
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

	tr, ok := service.FindTrainingRunByID(runs, p.ID)
	if !ok {
		return nil, gentrainingruns.MakeNotFound(fmt.Errorf("training run %q not found", p.ID))
	}

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
