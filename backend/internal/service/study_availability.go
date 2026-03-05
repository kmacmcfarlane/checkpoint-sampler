package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// StudyAvailabilityFileSystem defines the filesystem operations needed for
// study version availability checks.
type StudyAvailabilityFileSystem interface {
	ListSubdirectories(root string) ([]string, error)
	DirectoryExists(path string) bool
}

// StudyAvailabilityService checks which study versions have samples for a
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

// GetAvailability returns the version availability for a list of studies
// relative to the given training run. For each study, it discovers version
// directories on disk ({sample_dir}/{study.Name}/v*/) and checks whether
// any of the training run's checkpoint filenames exist as subdirectories
// under each version.
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
		versionDirs, err := s.fs.ListSubdirectories(studyDir)
		if err != nil {
			s.logger.WithFields(logrus.Fields{
				"study_name": study.Name,
				"study_dir":  studyDir,
				"error":      err.Error(),
			}).Error("failed to list version directories")
			return nil, fmt.Errorf("listing version dirs for study %q: %w", study.Name, err)
		}

		var versions []model.StudyVersionInfo
		for _, dir := range versionDirs {
			// Use the package-level versionDirPattern (^v\d+$) from viewer_discovery.go
			if !versionDirPattern.MatchString(dir) {
				continue
			}
			verStr := strings.TrimPrefix(dir, "v")
			ver, err := strconv.Atoi(verStr)
			if err != nil {
				continue
			}

			// Check whether any training run checkpoint directory exists under this version
			versionPath := filepath.Join(studyDir, dir)
			hasSamples := false

			checkpointDirs, err := s.fs.ListSubdirectories(versionPath)
			if err != nil {
				s.logger.WithFields(logrus.Fields{
					"study_name":  study.Name,
					"version_dir": versionPath,
					"error":       err.Error(),
				}).Error("failed to list checkpoint directories under version")
				return nil, fmt.Errorf("listing checkpoint dirs for study %q version %d: %w", study.Name, ver, err)
			}

			for _, cpDir := range checkpointDirs {
				if checkpointSet[cpDir] {
					hasSamples = true
					break
				}
			}

			versions = append(versions, model.StudyVersionInfo{
				Version:    ver,
				HasSamples: hasSamples,
			})
		}

		// Sort versions ascending
		sort.Slice(versions, func(i, j int) bool {
			return versions[i].Version < versions[j].Version
		})

		avail.Versions = versions
		result = append(result, avail)
	}

	s.logger.WithFields(logrus.Fields{
		"training_run": tr.Name,
		"study_count":  len(result),
	}).Debug("study availability computed")

	return result, nil
}
