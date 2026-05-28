package service

import (
	"sort"

	"github.com/sirupsen/logrus"
)

// BaseModelFileSystem defines filesystem operations needed by the base model service.
type BaseModelFileSystem interface {
	ListSafetensorsFiles(root string) ([]string, error)
}

// BaseModelService lists base models from a configured directory.
type BaseModelService struct {
	fs             BaseModelFileSystem
	baseModelDir   string
	checkpointDirs []string
	logger         *logrus.Entry
}

// NewBaseModelService creates a base model service. When baseModelDir is empty,
// the service falls back to checkpointDirs[0].
func NewBaseModelService(fs BaseModelFileSystem, baseModelDir string, checkpointDirs []string, logger *logrus.Logger) *BaseModelService {
	return &BaseModelService{
		fs:             fs,
		baseModelDir:   baseModelDir,
		checkpointDirs: checkpointDirs,
		logger:         logger.WithField("component", "base_model"),
	}
}

// ListBaseModels scans the resolved base model directory for .safetensors files.
// Returns the list sorted alphabetically.
func (s *BaseModelService) ListBaseModels() ([]string, error) {
	dir := s.resolveDir()
	if dir == "" {
		s.logger.Warn("no base model directory configured and no checkpoint directories available")
		return []string{}, nil
	}

	s.logger.WithField("dir", dir).Debug("scanning for base models")
	files, err := s.fs.ListSafetensorsFiles(dir)
	if err != nil {
		return nil, err
	}

	sort.Strings(files)
	return files, nil
}

// resolveDir returns base_model_dir if set, otherwise checkpoint_dirs[0].
func (s *BaseModelService) resolveDir() string {
	if s.baseModelDir != "" {
		return s.baseModelDir
	}
	if len(s.checkpointDirs) > 0 {
		return s.checkpointDirs[0]
	}
	return ""
}
