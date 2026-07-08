package service

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// ValidationFileSystem defines the filesystem operations needed for validation.
type ValidationFileSystem interface {
	ListPNGFiles(dir string) ([]string, error)
	DirectoryExists(path string) bool
	FileExists(path string) bool
	ReadFile(path string) ([]byte, error)
}

// ValidationService validates sample set completeness for a training run.
// It reuses the same completeness-check concept from S-075: for each checkpoint
// in a training run, it counts the PNG files in the checkpoint's sample directory
// and compares against the maximum count across all checkpoints.
type ValidationService struct {
	fs        ValidationFileSystem
	sampleDir string
	logger    *logrus.Entry
}

// NewValidationService creates a ValidationService.
func NewValidationService(fs ValidationFileSystem, sampleDir string, logger *logrus.Logger) *ValidationService {
	return &ValidationService{
		fs:        fs,
		sampleDir: sampleDir,
		logger:    logger.WithField("component", "validation"),
	}
}

// ValidateTrainingRun checks the completeness of sample images for a training run.
// For each checkpoint, it counts the PNG files in the sample directory. The maximum
// count across all checkpoints is treated as the expected count. Checkpoints with
// fewer files are flagged as having missing samples.
//
// The studyName parameter scopes the validation to a study subdirectory (empty for legacy).
func (v *ValidationService) ValidateTrainingRun(tr model.TrainingRun, studyName string) (*model.ValidationResult, error) {
	v.logger.WithFields(logrus.Fields{
		"training_run": tr.Name,
		"study_name":   studyName,
	}).Trace("entering ValidateTrainingRun")
	defer v.logger.Trace("returning from ValidateTrainingRun")

	type cpCount struct {
		checkpoint string
		count      int
	}

	var counts []cpCount
	maxCount := 0

	for _, cp := range tr.Checkpoints {
		// When a studyName is provided, always check the study-scoped directory
		// directly. The cp.HasSamples flag is set by discovery based on the legacy
		// path (sample_dir/<filename>/), which does not reflect study-scoped state.
		// Only skip for legacy (non-study) validation when HasSamples is false.
		if studyName == "" && !cp.HasSamples {
			counts = append(counts, cpCount{checkpoint: cp.Filename, count: 0})
			continue
		}

		var sampleDirPath string
		if studyName != "" {
			sampleDirPath = filepath.Join(v.sampleDir, studyName, cp.Filename)
		} else {
			sampleDirPath = filepath.Join(v.sampleDir, cp.Filename)
		}

		if !v.fs.DirectoryExists(sampleDirPath) {
			v.logger.WithFields(logrus.Fields{
				"checkpoint":     cp.Filename,
				"checkpoint_dir": sampleDirPath,
			}).Debug("checkpoint sample directory does not exist during validation")
			counts = append(counts, cpCount{checkpoint: cp.Filename, count: 0})
			continue
		}

		files, err := v.fs.ListPNGFiles(sampleDirPath)
		if err != nil {
			v.logger.WithFields(logrus.Fields{
				"checkpoint":     cp.Filename,
				"checkpoint_dir": sampleDirPath,
				"error":          err.Error(),
			}).Error("failed to list PNG files during validation")
			return nil, fmt.Errorf("listing PNG files for checkpoint %q: %w", cp.Filename, err)
		}

		n := len(files)
		counts = append(counts, cpCount{checkpoint: cp.Filename, count: n})
		if n > maxCount {
			maxCount = n
		}
	}

	// Build completeness info: expected = maxCount, verified = actual count, missing = expected - verified
	totalExpected := maxCount * len(counts)
	totalVerified := 0
	result := &model.ValidationResult{
		Checkpoints:           make([]model.CheckpointCompletenessInfo, len(counts)),
		ExpectedPerCheckpoint: maxCount,
		TotalExpected:         totalExpected,
	}
	for i, cc := range counts {
		verified := cc.count
		missing := maxCount - verified
		totalVerified += verified
		result.Checkpoints[i] = model.CheckpointCompletenessInfo{
			Checkpoint: cc.checkpoint,
			Expected:   maxCount,
			Verified:   verified,
			Missing:    missing,
		}

		if missing > 0 {
			v.logger.WithFields(logrus.Fields{
				"checkpoint": cc.checkpoint,
				"expected":   maxCount,
				"verified":   verified,
				"missing":    missing,
			}).Warn("validation found missing files")
		}
	}
	result.TotalVerified = totalVerified
	result.TotalActual = totalVerified
	if diff := totalExpected - totalVerified; diff > 0 {
		result.TotalMissing = diff
	}

	v.logger.WithFields(logrus.Fields{
		"training_run":     tr.Name,
		"checkpoint_count": len(counts),
		"max_count":        maxCount,
		"total_expected":   totalExpected,
		"total_verified":   totalVerified,
		"total_missing":    result.TotalMissing,
	}).Info("validation completed")

	return result, nil
}

// ValidateTrainingRunWithStudy checks completeness against a study's expected image count
// rather than the max-file-count heuristic. For each checkpoint, the expected count is
// the study's ImagesPerCheckpoint(). This enables the Generate Samples dialog to show
// expected vs actual sample counts and identify which checkpoints need (re)generation.
//
// The studyName parameter scopes the sample directory to a study subdirectory (empty for legacy).
func (v *ValidationService) ValidateTrainingRunWithStudy(tr model.TrainingRun, study model.Study, studyName string) (*model.ValidationResult, error) {
	v.logger.WithFields(logrus.Fields{
		"training_run": tr.Name,
		"study_name":   studyName,
		"study_id":     study.ID,
	}).Trace("entering ValidateTrainingRunWithStudy")
	defer v.logger.Trace("returning from ValidateTrainingRunWithStudy")

	expectedPerCheckpoint := study.ImagesPerCheckpoint()
	totalExpected := expectedPerCheckpoint * len(tr.Checkpoints)
	totalVerified := 0

	result := &model.ValidationResult{
		Checkpoints:           make([]model.CheckpointCompletenessInfo, 0, len(tr.Checkpoints)),
		ExpectedPerCheckpoint: expectedPerCheckpoint,
		TotalExpected:         totalExpected,
	}

	for _, cp := range tr.Checkpoints {
		verified := 0

		// When a studyName is provided, always check the study-scoped directory
		// directly regardless of cp.HasSamples. The HasSamples flag is set by
		// discovery based on the legacy path (sample_dir/<filename>/), which
		// does not reflect study-scoped state. Only skip for legacy (non-study)
		// validation when HasSamples is false.
		shouldCheck := cp.HasSamples || studyName != ""
		if shouldCheck {
			var sampleDirPath string
			if studyName != "" {
				sampleDirPath = filepath.Join(v.sampleDir, studyName, cp.Filename)
			} else {
				sampleDirPath = filepath.Join(v.sampleDir, cp.Filename)
			}

			if v.fs.DirectoryExists(sampleDirPath) {
				files, err := v.fs.ListPNGFiles(sampleDirPath)
				if err != nil {
					v.logger.WithFields(logrus.Fields{
						"checkpoint":     cp.Filename,
						"checkpoint_dir": sampleDirPath,
						"error":          err.Error(),
					}).Error("failed to list PNG files during study validation")
					return nil, fmt.Errorf("listing PNG files for checkpoint %q: %w", cp.Filename, err)
				}
				verified = len(files)
			} else {
				v.logger.WithFields(logrus.Fields{
					"checkpoint":     cp.Filename,
					"checkpoint_dir": sampleDirPath,
				}).Debug("checkpoint sample directory does not exist during study validation")
			}
		}

		missing := 0
		extra := 0
		if verified < expectedPerCheckpoint {
			missing = expectedPerCheckpoint - verified
		} else if verified > expectedPerCheckpoint {
			extra = verified - expectedPerCheckpoint
		}

		totalVerified += verified

		result.Checkpoints = append(result.Checkpoints, model.CheckpointCompletenessInfo{
			Checkpoint: cp.Filename,
			Expected:   expectedPerCheckpoint,
			Verified:   verified,
			Missing:    missing,
			Extra:      extra,
		})

		if missing > 0 {
			v.logger.WithFields(logrus.Fields{
				"checkpoint": cp.Filename,
				"expected":   expectedPerCheckpoint,
				"verified":   verified,
				"missing":    missing,
			}).Warn("study validation found missing files")
		}
		if extra > 0 {
			v.logger.WithFields(logrus.Fields{
				"checkpoint": cp.Filename,
				"expected":   expectedPerCheckpoint,
				"verified":   verified,
				"extra":      extra,
			}).Warn("study validation found extra files beyond expected count")
		}
	}

	result.TotalVerified = totalVerified
	result.TotalActual = totalVerified
	for _, cp := range result.Checkpoints {
		result.TotalMissing += cp.Missing
		result.TotalExtra += cp.Extra
	}

	v.logger.WithFields(logrus.Fields{
		"training_run":     tr.Name,
		"checkpoint_count": len(tr.Checkpoints),
		"expected_per_cp":  expectedPerCheckpoint,
		"total_expected":   totalExpected,
		"total_verified":   totalVerified,
		"total_missing":    result.TotalMissing,
		"total_extra":      result.TotalExtra,
	}).Info("study validation completed")

	return result, nil
}

// ValidateTrainingRunWithManifest checks completeness using a manifest file as the
// source of truth for expected outputs, rather than the live study config. The manifest
// is read from {sampleDir}/{studyOutputDir}/manifest.json.
//
// The validation approach:
//  1. Generate all expected sample filenames from the manifest's parameter
//     combinations (Cartesian product of prompts × steps × cfgs × pairs × seeds).
//  2. For each checkpoint, check each expected sample:
//     (a) the PNG file exists on disk,
//     (b) the sidecar JSON file exists and its params exactly match the manifest.
//  3. Files present in the directory but not matching any expected parameter
//     combination are counted as "extra" (foreign samples). They are NOT counted
//     as verified — only expected samples that fully pass the checks are verified.
//
// This is strict-count validation: extra foreign samples cause validation failure.
//
// AC: Validating a sample set uses the manifest as the source of truth for expected outputs.
func (v *ValidationService) ValidateTrainingRunWithManifest(tr model.TrainingRun, studyOutputDir string) (*model.ValidationResult, error) {
	v.logger.WithFields(logrus.Fields{
		"training_run":     tr.Name,
		"study_output_dir": studyOutputDir,
	}).Trace("entering ValidateTrainingRunWithManifest")
	defer v.logger.Trace("returning from ValidateTrainingRunWithManifest")

	// Read the manifest from disk
	manifestPath := filepath.Join(v.sampleDir, studyOutputDir, fileformat.ManifestFilename)
	data, err := v.fs.ReadFile(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			v.logger.WithField("manifest_path", manifestPath).Debug("manifest not found")
			return nil, fmt.Errorf("manifest not found: %w", ErrManifestNotFound)
		}
		v.logger.WithFields(logrus.Fields{
			"manifest_path": manifestPath,
			"error":         err.Error(),
		}).Error("failed to read manifest file")
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	manifest, err := fileformat.UnmarshalManifest(data)
	if err != nil {
		v.logger.WithFields(logrus.Fields{
			"manifest_path": manifestPath,
			"error":         err.Error(),
		}).Error("failed to parse manifest file")
		return nil, fmt.Errorf("parsing manifest: %w", err)
	}

	expectedPerCheckpoint := manifest.ImagesPerCheckpoint
	totalExpected := expectedPerCheckpoint * len(tr.Checkpoints)
	totalVerified := 0
	totalActual := 0

	result := &model.ValidationResult{
		Checkpoints:           make([]model.CheckpointCompletenessInfo, 0, len(tr.Checkpoints)),
		ExpectedPerCheckpoint: expectedPerCheckpoint,
		TotalExpected:         totalExpected,
	}

	// Build the set of expected filenames from manifest parameter combinations.
	// This is the validation set: only files matching these names (with valid
	// sidecar params) are counted as verified.
	expectedFilenames := buildExpectedFilenames(manifest)

	// Build lookup sets from manifest params for per-sample sidecar verification.
	manifestParams := buildManifestParamSets(manifest)

	for _, cp := range tr.Checkpoints {
		verified := 0
		invalidParams := 0
		actualCount := 0

		// Always check the study output directory directly regardless of
		// cp.HasSamples. The HasSamples flag is set by discovery based on
		// the legacy path (sample_dir/<filename>/), which does not reflect
		// whether samples exist in this specific study output directory.
		// B-115: use filepath.Base defensively to ensure only the filename is used
		sampleDirPath := filepath.Join(v.sampleDir, studyOutputDir, filepath.Base(cp.Filename))

		// Build a set of actual files present on disk (for counting extra/foreign samples).
		actualFilesOnDisk := map[string]struct{}{}
		if v.fs.DirectoryExists(sampleDirPath) {
			files, err := v.fs.ListPNGFiles(sampleDirPath)
			if err != nil {
				v.logger.WithFields(logrus.Fields{
					"checkpoint":     cp.Filename,
					"checkpoint_dir": sampleDirPath,
					"error":          err.Error(),
				}).Error("failed to list PNG files during manifest validation")
				return nil, fmt.Errorf("listing PNG files for checkpoint %q: %w", cp.Filename, err)
			}
			for _, f := range files {
				actualFilesOnDisk[f] = struct{}{}
			}
			actualCount = len(files)
		}

		// Validate each expected sample by parameter combination.
		for expectedFilename := range expectedFilenames {
			pngPath := filepath.Join(sampleDirPath, expectedFilename)
			if !v.fs.FileExists(pngPath) {
				// Expected PNG is missing entirely.
				v.logger.WithFields(logrus.Fields{
					"checkpoint":        cp.Filename,
					"expected_filename": expectedFilename,
				}).Debug("manifest validation: expected PNG not found")
				continue
			}

			// PNG exists — verify sidecar params.
			sidecarPath := filepath.Join(sampleDirPath, strings.TrimSuffix(expectedFilename, ".png")+".json")
			invalid, notFound, sidecarErr := v.isSidecarParamMismatch(sidecarPath, manifestParams)
			if sidecarErr != nil {
				v.logger.WithFields(logrus.Fields{
					"checkpoint":   cp.Filename,
					"sidecar_path": sidecarPath,
					"error":        sidecarErr.Error(),
				}).Debug("could not read sidecar file during manifest validation; treating as invalid params")
				invalidParams++
				continue
			}
			if notFound {
				// PNG exists but no sidecar: skip param verification — count as verified.
				// Older outputs may pre-date sidecar generation.
				verified++
				continue
			}
			if invalid {
				invalidParams++
				v.logger.WithFields(logrus.Fields{
					"checkpoint":        cp.Filename,
					"expected_filename": expectedFilename,
					"sidecar_path":      sidecarPath,
				}).Warn("manifest validation: expected sample has sidecar params not matching manifest")
				continue
			}
			verified++
		}

		// Count foreign (unexpected) files: files present on disk that do not
		// correspond to any expected parameter combination. These are NOT counted
		// as verified; their presence indicates a contaminated sample set.
		extra := 0
		for f := range actualFilesOnDisk {
			if _, expected := expectedFilenames[f]; !expected {
				extra++
				v.logger.WithFields(logrus.Fields{
					"checkpoint":      cp.Filename,
					"foreign_file":    f,
					"checkpoint_dir":  sampleDirPath,
				}).Warn("manifest validation: found foreign (unexpected) sample file")
			}
		}

		missing := expectedPerCheckpoint - verified

		totalVerified += verified
		totalActual += actualCount

		result.Checkpoints = append(result.Checkpoints, model.CheckpointCompletenessInfo{
			Checkpoint:    cp.Filename,
			Expected:      expectedPerCheckpoint,
			Verified:      verified,
			Missing:       missing,
			Extra:         extra,
			InvalidParams: invalidParams,
		})

		if missing > 0 {
			v.logger.WithFields(logrus.Fields{
				"checkpoint":     cp.Filename,
				"expected":       expectedPerCheckpoint,
				"verified":       verified,
				"missing":        missing,
				"invalid_params": invalidParams,
			}).Warn("manifest validation found missing or invalid samples")
		}
		if extra > 0 {
			v.logger.WithFields(logrus.Fields{
				"checkpoint": cp.Filename,
				"expected":   expectedPerCheckpoint,
				"actual":     actualCount,
				"extra":      extra,
			}).Warn("manifest validation found foreign files beyond expected parameter set")
		}
	}

	result.TotalVerified = totalVerified
	result.TotalActual = totalActual
	for _, cp := range result.Checkpoints {
		result.TotalMissing += cp.Missing
		result.TotalExtra += cp.Extra
		result.TotalInvalidParams += cp.InvalidParams
	}

	v.logger.WithFields(logrus.Fields{
		"training_run":         tr.Name,
		"checkpoint_count":     len(tr.Checkpoints),
		"expected_per_cp":      expectedPerCheckpoint,
		"total_expected":       totalExpected,
		"total_verified":       totalVerified,
		"total_actual":         totalActual,
		"total_missing":        result.TotalMissing,
		"total_extra":          result.TotalExtra,
		"total_invalid_params": result.TotalInvalidParams,
	}).Info("manifest validation completed")

	return result, nil
}

// buildExpectedFilenames generates the set of expected PNG filenames from a
// manifest's parameter combinations (Cartesian product of prompts × steps × cfgs
// × sampler/scheduler pairs × seeds × the S-157 promoted dimensions:
// resolutions/vaes/text_encoders/shifts). The returned map is keyed by filename
// for O(1) membership tests.
//
// S-157: a promoted dimension is only expanded (and only encoded into the
// filename) when the manifest carries more than one value for it — this
// mirrors filenameDimensionsForStudy/GenerateOutputFilenameWithDims gating, so
// the expected-filename set always matches what the executor actually wrote to
// disk for both single-value and swept studies.
func buildExpectedFilenames(m fileformat.JobManifest) map[string]struct{} {
	total := len(m.Prompts) * len(m.Steps) * len(m.CFGs) * len(m.SamplerSchedulerPairs) * len(m.Seeds)
	if total == 0 {
		return map[string]struct{}{}
	}

	// Determine the swept dimensions and their iteration lists, mirroring
	// expandJobItems' "empty collapses to a single implicit value" semantics.
	dims := FilenameDimensions{
		Resolution:  len(m.Resolutions) > 1,
		VAE:         len(m.VAEs) > 1,
		TextEncoder: len(m.TextEncoders) > 1,
		Shift:       len(m.Shifts) > 1,
	}

	resolutions := m.Resolutions
	if len(resolutions) == 0 {
		resolutions = []fileformat.ManifestResolutionPair{{Width: m.Width, Height: m.Height}}
	}
	vaes := m.VAEs
	if len(vaes) == 0 {
		vaes = []string{""}
	}
	textEncoders := m.TextEncoders
	if len(textEncoders) == 0 {
		textEncoders = []string{""}
	}
	shifts := make([]*float64, 0, len(m.Shifts))
	for i := range m.Shifts {
		v := m.Shifts[i]
		shifts = append(shifts, &v)
	}
	if len(shifts) == 0 {
		shifts = []*float64{nil}
	}

	total *= len(resolutions) * len(vaes) * len(textEncoders) * len(shifts)
	result := make(map[string]struct{}, total)
	for _, prompt := range m.Prompts {
		for _, steps := range m.Steps {
			for _, cfg := range m.CFGs {
				for _, pair := range m.SamplerSchedulerPairs {
					for _, seed := range m.Seeds {
						for _, res := range resolutions {
							for _, vae := range vaes {
								for _, te := range textEncoders {
									for _, shift := range shifts {
										filename := GenerateOutputFilenameWithDims(model.SampleJobItem{
											PromptName:  prompt.Name,
											Steps:       steps,
											CFG:         cfg,
											SamplerName: pair.Sampler,
											Scheduler:   pair.Scheduler,
											Seed:        seed,
											Width:       res.Width,
											Height:      res.Height,
											VAE:         vae,
											TextEncoder: te,
											Shift:       shift,
										}, dims)
										result[filename] = struct{}{}
									}
								}
							}
						}
					}
				}
			}
		}
	}
	return result
}

// manifestParamSets holds the allowed values from a manifest for per-sample verification.
type manifestParamSets struct {
	seeds     map[int64]struct{}
	cfgs      map[float64]struct{}
	steps     map[int]struct{}
	pairs     map[string]struct{} // "sampler|scheduler"
	prompts   map[string]struct{} // prompt names
}

// buildManifestParamSets constructs lookup sets from a manifest for O(1) membership tests.
func buildManifestParamSets(m fileformat.JobManifest) manifestParamSets {
	seeds := make(map[int64]struct{}, len(m.Seeds))
	for _, s := range m.Seeds {
		seeds[s] = struct{}{}
	}
	cfgs := make(map[float64]struct{}, len(m.CFGs))
	for _, c := range m.CFGs {
		cfgs[c] = struct{}{}
	}
	steps := make(map[int]struct{}, len(m.Steps))
	for _, st := range m.Steps {
		steps[st] = struct{}{}
	}
	pairs := make(map[string]struct{}, len(m.SamplerSchedulerPairs))
	for _, p := range m.SamplerSchedulerPairs {
		pairs[p.Sampler+"|"+p.Scheduler] = struct{}{}
	}
	prompts := make(map[string]struct{}, len(m.Prompts))
	for _, p := range m.Prompts {
		prompts[p.Name] = struct{}{}
	}
	return manifestParamSets{
		seeds:   seeds,
		cfgs:    cfgs,
		steps:   steps,
		pairs:   pairs,
		prompts: prompts,
	}
}

// isSidecarParamMismatch reads a sidecar JSON file and checks its generation params
// against the manifest's allowed value sets.
//
// Returns (mismatch bool, notFound bool, err error):
//   - mismatch=true when the sidecar exists but contains params outside the manifest.
//   - notFound=true when the sidecar file does not exist (caller should skip verification).
//   - err is non-nil only when the sidecar file exists but cannot be parsed.
func (v *ValidationService) isSidecarParamMismatch(sidecarPath string, params manifestParamSets) (mismatch bool, notFound bool, err error) {
	data, readErr := v.fs.ReadFile(sidecarPath)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			return false, true, nil
		}
		return false, false, fmt.Errorf("reading sidecar %q: %w", sidecarPath, readErr)
	}

	var sc fileformat.SidecarMetadata
	if err := json.Unmarshal(data, &sc); err != nil {
		return false, false, fmt.Errorf("parsing sidecar %q: %w", sidecarPath, err)
	}

	if _, ok := params.seeds[sc.Seed]; !ok {
		return true, false, nil
	}
	if _, ok := params.cfgs[sc.CFG]; !ok {
		return true, false, nil
	}
	if _, ok := params.steps[sc.Steps]; !ok {
		return true, false, nil
	}
	pairKey := sc.SamplerName + "|" + sc.Scheduler
	if _, ok := params.pairs[pairKey]; !ok {
		return true, false, nil
	}
	if _, ok := params.prompts[sc.PromptName]; !ok {
		return true, false, nil
	}

	return false, false, nil
}

// ReadManifest reads and parses a manifest from the study output directory.
// Returns the parsed manifest or an error if the file doesn't exist or can't be parsed.
//
// AC3: Regenerating a sample set reads the manifest to determine what to generate.
func (v *ValidationService) ReadManifest(studyOutputDir string) (fileformat.JobManifest, error) {
	v.logger.WithField("study_output_dir", studyOutputDir).Trace("entering ReadManifest")
	defer v.logger.Trace("returning from ReadManifest")

	manifestPath := filepath.Join(v.sampleDir, studyOutputDir, fileformat.ManifestFilename)
	data, err := v.fs.ReadFile(manifestPath)
	if err != nil {
		if os.IsNotExist(err) {
			v.logger.WithField("manifest_path", manifestPath).Debug("manifest not found")
			return fileformat.JobManifest{}, fmt.Errorf("manifest not found: %w", ErrManifestNotFound)
		}
		return fileformat.JobManifest{}, fmt.Errorf("reading manifest: %w", err)
	}

	manifest, err := fileformat.UnmarshalManifest(data)
	if err != nil {
		return fileformat.JobManifest{}, fmt.Errorf("parsing manifest: %w", err)
	}

	v.logger.WithFields(logrus.Fields{
		"manifest_path": manifestPath,
		"job_id":        manifest.JobID,
	}).Debug("manifest read successfully")

	return manifest, nil
}
