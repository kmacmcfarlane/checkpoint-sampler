package service

import (
	"fmt"
	"path/filepath"

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
// under the study's output directory ({sample_dir}/{study.Name}/).
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

		studyDir := filepath.Join(s.sampleDir, study.Name)
		checkpointDirs, err := s.fs.ListSubdirectories(studyDir)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"study_name": study.Name,
				"study_dir":  studyDir,
				"error":      err.Error(),
			}).Error("failed to list checkpoint directories for study")
			return nil, fmt.Errorf("listing checkpoint dirs for study %q: %w", study.Name, err)
		}

		for _, cpDir := range checkpointDirs {
			if checkpointSet[cpDir] {
				avail.HasSamples = true
				break
			}
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
// one subdirectory (which would be a checkpoint directory with sample images).
func (s *StudyAvailabilityService) StudyHasSamples(study model.Study) (bool, error) {
	s.logger.WithField("study_name", study.Name).Trace("entering StudyHasSamples")
	defer s.logger.Trace("returning from StudyHasSamples")

	studyDir := filepath.Join(s.sampleDir, study.Name)
	if !s.fs.DirectoryExists(studyDir) {
		s.logger.WithField("study_dir", studyDir).Debug("study directory does not exist")
		return false, nil
	}

	subdirs, err := s.fs.ListSubdirectories(studyDir)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_name": study.Name,
			"study_dir":  studyDir,
			"error":      err.Error(),
		}).Error("failed to list study directory")
		return false, fmt.Errorf("listing study directory %q: %w", study.Name, err)
	}

	hasSamples := len(subdirs) > 0
	s.logger.WithFields(logrus.Fields{
		"study_name":  study.Name,
		"has_samples": hasSamples,
		"subdir_count": len(subdirs),
	}).Debug("study has-samples check completed")

	return hasSamples, nil
}
