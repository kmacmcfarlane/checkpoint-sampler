package service

import (
	"fmt"
	"path/filepath"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// ValidationFileSystem defines the filesystem operations needed for validation.
type ValidationFileSystem interface {
	ListPNGFiles(dir string) ([]string, error)
	DirectoryExists(path string) bool
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
		if !cp.HasSamples {
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
			}).Warn("checkpoint sample directory does not exist during validation")
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

	v.logger.WithFields(logrus.Fields{
		"training_run":     tr.Name,
		"checkpoint_count": len(counts),
		"max_count":        maxCount,
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

		if cp.HasSamples {
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
				}).Warn("checkpoint sample directory does not exist during study validation")
			}
		}

		missing := expectedPerCheckpoint - verified
		if missing < 0 {
			missing = 0
		}

		totalVerified += verified

		result.Checkpoints = append(result.Checkpoints, model.CheckpointCompletenessInfo{
			Checkpoint: cp.Filename,
			Expected:   expectedPerCheckpoint,
			Verified:   verified,
			Missing:    missing,
		})

		if missing > 0 {
			v.logger.WithFields(logrus.Fields{
				"checkpoint": cp.Filename,
				"expected":   expectedPerCheckpoint,
				"verified":   verified,
				"missing":    missing,
			}).Warn("study validation found missing files")
		}
	}

	result.TotalVerified = totalVerified

	v.logger.WithFields(logrus.Fields{
		"training_run":     tr.Name,
		"checkpoint_count": len(tr.Checkpoints),
		"expected_per_cp":  expectedPerCheckpoint,
		"total_expected":   totalExpected,
		"total_verified":   totalVerified,
	}).Info("study validation completed")

	return result, nil
}
