package service

import (
	"fmt"
	"path/filepath"
	"sort"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// StudyAvailabilityFileSystem defines the filesystem operations needed for
// study sample availability checks.
type StudyAvailabilityFileSystem interface {
	ListSubdirectories(root string) ([]string, error)
	DirectoryExists(path string) bool
}

// StudyAvailabilityService checks which studies have samples for a
// given training run by examining the filesystem.
type StudyAvailabilityService struct {
	fs        StudyAvailabilityFileSystem
	sampleDir string
	logger    *logrus.Entry
}

// NewStudyAvailabilityService creates a StudyAvailabilityService.
func NewStudyAvailabilityService(fs StudyAvailabilityFileSystem, sampleDir string, logger *logrus.Logger) *StudyAvailabilityService {
	return &StudyAvailabilityService{
		fs:        fs,
		sampleDir: sampleDir,
		logger:    logger.WithField("component", "study_availability"),
	}
}

// GetAvailability returns the sample availability for a list of studies
// relative to the given training run. For each study, it checks whether
// any of the training run's checkpoint filenames exist as subdirectories
// under the study's output directory ({sample_dir}/{sanitized_run_name}/{study.Name}/).
func (s *StudyAvailabilityService) GetAvailability(studies []model.Study, tr model.TrainingRun) ([]model.StudyAvailability, error) {
	s.logger.WithFields(logrus.Fields{
		"training_run": tr.Name,
		"study_count":  len(studies),
	}).Trace("entering GetAvailability")
	defer s.logger.Trace("returning from GetAvailability")

	checkpointSet := make(map[string]bool, len(tr.Checkpoints))
	for _, cp := range tr.Checkpoints {
		checkpointSet[cp.Filename] = true
	}

	result := make([]model.StudyAvailability, 0, len(studies))

	for _, study := range studies {
		avail := model.StudyAvailability{
			StudyID:   study.ID,
			StudyName: study.Name,
		}

		studyDir := filepath.Join(s.sampleDir, fileformat.SanitizeTrainingRunName(tr.Name), study.Name)
		checkpointDirs, err := s.fs.ListSubdirectories(studyDir)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"study_name": study.Name,
				"study_dir":  studyDir,
				"error":      err.Error(),
			}).Error("failed to list checkpoint directories for study")
			return nil, fmt.Errorf("listing checkpoint dirs for study %q: %w", study.Name, err)
		}

		// Count how many of the training run's checkpoints have a matching
		// sample directory under this study. Two layouts are supported:
		//   - checkpoint runs: {run}/{study}/{checkpoint}/
		//   - LoRA runs:       {run}/{study}/{base_model}/{checkpoint}/
		// For LoRA runs the immediate subdirectories are base-model directories
		// (their names do not end in ".safetensors"); the checkpoint directories
		// live one level deeper. We collect base-model directory names (B-145)
		// and descend into them so the checkpoint match count is correct for
		// both layouts.
		cpDirSet := make(map[string]bool, len(checkpointDirs))
		baseModelSet := make(map[string]struct{})
		for _, cpDir := range checkpointDirs {
			if isCheckpointDirName(cpDir) {
				cpDirSet[cpDir] = true
				continue
			}
			// Non-checkpoint subdir: treat as a LoRA base-model directory and
			// descend to find its checkpoint subdirectories.
			baseModelDir := filepath.Join(studyDir, cpDir)
			nested, nestedErr := s.fs.ListSubdirectories(baseModelDir)
			if nestedErr != nil {
				s.logger.WithFields(logrus.Fields{
					"study_name":     study.Name,
					"base_model_dir": baseModelDir,
					"error":          nestedErr.Error(),
				}).Warn("failed to list base model subdirectory; skipping")
				continue
			}
			hasCheckpoint := false
			for _, nestedDir := range nested {
				if isCheckpointDirName(nestedDir) {
					cpDirSet[nestedDir] = true
					hasCheckpoint = true
				}
			}
			if hasCheckpoint {
				baseModelSet[cpDir] = struct{}{}
			}
		}

		matchCount := 0
		for cp := range checkpointSet {
			if cpDirSet[cp] {
				matchCount++
			}
		}

		if len(baseModelSet) > 0 {
			baseModels := make([]string, 0, len(baseModelSet))
			for bm := range baseModelSet {
				baseModels = append(baseModels, bm)
			}
			sort.Strings(baseModels)
			avail.BaseModels = baseModels
		}

		totalCheckpoints := len(checkpointSet)
		avail.HasSamples = matchCount > 0
		avail.CheckpointsWithSamples = matchCount
		avail.TotalCheckpoints = totalCheckpoints
		switch {
		case totalCheckpoints == 0 || matchCount == 0:
			avail.SampleStatus = model.StudySampleStatusNone
		case matchCount == totalCheckpoints:
			avail.SampleStatus = model.StudySampleStatusComplete
		default:
			avail.SampleStatus = model.StudySampleStatusPartial
		}

		result = append(result, avail)
	}

	s.logger.WithFields(logrus.Fields{
		"training_run": tr.Name,
		"study_count":  len(result),
	}).Debug("study availability computed")

	return result, nil
}

// StudyHasSamples checks whether a specific study has any generated samples
// on disk. It returns true if the study's output directory contains at least
// one subdirectory (which would be a checkpoint directory with sample images)
// under any training run directory.
//
// Samples are stored at {sampleDir}/{sanitized_run_name}/{study.Name}/{checkpoint}/,
// so this method scans all subdirectories of sampleDir (training run dirs) and
// checks whether any of them contains a non-empty study subdirectory.
func (s *StudyAvailabilityService) StudyHasSamples(study model.Study) (bool, error) {
	s.logger.WithField("study_name", study.Name).Trace("entering StudyHasSamples")
	defer s.logger.Trace("returning from StudyHasSamples")

	// List all training run directories under the sample root.
	runDirs, err := s.fs.ListSubdirectories(s.sampleDir)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_dir": s.sampleDir,
			"error":      err.Error(),
		}).Error("failed to list sample directory for has-samples check")
		return false, fmt.Errorf("listing sample directory: %w", err)
	}

	for _, runDir := range runDirs {
		studyDir := filepath.Join(s.sampleDir, runDir, study.Name)
		if !s.fs.DirectoryExists(studyDir) {
			continue
		}
		subdirs, err := s.fs.ListSubdirectories(studyDir)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"study_name": study.Name,
				"study_dir":  studyDir,
				"error":      err.Error(),
			}).Error("failed to list study directory for has-samples check")
			return false, fmt.Errorf("listing study directory %q: %w", studyDir, err)
		}
		if len(subdirs) > 0 {
			s.logger.WithFields(logrus.Fields{
				"study_name":   study.Name,
				"run_dir":      runDir,
				"subdir_count": len(subdirs),
			}).Debug("study has-samples check: found samples")
			return true, nil
		}
	}

	s.logger.WithField("study_name", study.Name).Debug("study has-samples check: no samples found")
	return false, nil
}
