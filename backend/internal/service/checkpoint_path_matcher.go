package service

import (
	"context"
	"fmt"

	"github.com/sirupsen/logrus"
)

// ComfyUIModelsProvider defines the interface for querying ComfyUI's available models.
type ComfyUIModelsProvider interface {
	GetModels(ctx context.Context, modelType ComfyUIModelType) ([]string, error)
}

// CheckpointPathMatcher matches checkpoint filenames to ComfyUI model paths.
type CheckpointPathMatcher struct {
	modelsProvider ComfyUIModelsProvider
	logger         *logrus.Entry
}

// NewCheckpointPathMatcher creates a CheckpointPathMatcher.
func NewCheckpointPathMatcher(modelsProvider ComfyUIModelsProvider, logger *logrus.Logger) *CheckpointPathMatcher {
	return &CheckpointPathMatcher{
		modelsProvider: modelsProvider,
		logger:         logger.WithField("component", "checkpoint_path_matcher"),
	}
}

// MatchCheckpointPath queries ComfyUI for available UNETs and finds a matching path by filename.
// Returns the ComfyUI-relative model path, or an error if no match is found.
func (m *CheckpointPathMatcher) MatchCheckpointPath(filename string) (string, error) {
	m.logger.WithField("checkpoint_filename", filename).Trace("entering MatchCheckpointPath")
	defer m.logger.Trace("returning from MatchCheckpointPath")

	// Query ComfyUI for available UNET models
	ctx := context.Background()
	models, err := m.modelsProvider.GetModels(ctx, ComfyUIModelTypeUNET)
	if err != nil {
		m.logger.WithFields(logrus.Fields{
			"checkpoint_filename": filename,
			"error":               err.Error(),
		}).Error("failed to query ComfyUI for UNET models")
		return "", fmt.Errorf("querying ComfyUI models: %w", err)
	}
	m.logger.WithFields(logrus.Fields{
		"checkpoint_filename": filename,
		"model_count":         len(models),
	}).Debug("fetched UNET models from ComfyUI")

	// Match by exact filename (ComfyUI paths may have directory prefixes)
	for _, modelPath := range models {
		// Check if the modelPath ends with the checkpoint filename
		// (handles cases where ComfyUI returns "subdirectory/filename.safetensors")
		if endsWithFilename(modelPath, filename) {
			m.logger.WithFields(logrus.Fields{
				"checkpoint_filename": filename,
				"comfyui_path":        modelPath,
			}).Debug("matched checkpoint to ComfyUI model path")
			return modelPath, nil
		}
	}

	m.logger.WithFields(logrus.Fields{
		"checkpoint_filename": filename,
		"model_count":         len(models),
	}).Debug("no matching ComfyUI model found for checkpoint")
	return "", fmt.Errorf("checkpoint %s not found in ComfyUI UNET models", filename)
}

// endsWithFilename checks if path ends with filename, accounting for directory separators.
func endsWithFilename(path, filename string) bool {
	if path == filename {
		return true
	}
	// Check if path ends with /filename or \filename
	if len(path) > len(filename) {
		if path[len(path)-len(filename)-1] == '/' || path[len(path)-len(filename)-1] == '\\' {
			return path[len(path)-len(filename):] == filename
		}
	}
	return false
}
