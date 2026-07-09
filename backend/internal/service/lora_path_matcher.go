package service

import (
	"context"
	"fmt"

	"github.com/sirupsen/logrus"
)

// LoraPathMatcher matches LoRA checkpoint filenames to ComfyUI LoRA model paths.
// It queries ComfyUI's LoRA model list via object_info/LoraLoader instead of
// the UNET list used by CheckpointPathMatcher.
type LoraPathMatcher struct {
	modelsProvider ComfyUIModelsProvider
	logger         *logrus.Entry
}

// NewLoraPathMatcher creates a LoraPathMatcher.
func NewLoraPathMatcher(modelsProvider ComfyUIModelsProvider, logger *logrus.Logger) *LoraPathMatcher {
	return &LoraPathMatcher{
		modelsProvider: modelsProvider,
		logger:         logger.WithField("component", "lora_path_matcher"),
	}
}

// MatchCheckpointPath queries ComfyUI for available LoRA models and finds a matching path by filename.
// Returns the ComfyUI-relative model path, or an error if no match is found.
func (m *LoraPathMatcher) MatchCheckpointPath(filename string) (string, error) {
	m.logger.WithField("checkpoint_filename", filename).Trace("entering MatchCheckpointPath")
	defer m.logger.Trace("returning from MatchCheckpointPath")

	// Query ComfyUI for available LoRA models
	ctx := context.Background()
	models, err := m.modelsProvider.GetModels(ctx, ComfyUIModelTypeLoRA)
	if err != nil {
		m.logger.WithFields(logrus.Fields{
			"checkpoint_filename": filename,
			"error":               err.Error(),
		}).Error("failed to query ComfyUI for LoRA models")
		return "", fmt.Errorf("querying ComfyUI LoRA models: %w", err)
	}
	m.logger.WithFields(logrus.Fields{
		"checkpoint_filename": filename,
		"model_count":         len(models),
	}).Debug("fetched LoRA models from ComfyUI")

	// Match by exact filename (ComfyUI paths may have directory prefixes)
	for _, modelPath := range models {
		if endsWithFilename(modelPath, filename) {
			m.logger.WithFields(logrus.Fields{
				"checkpoint_filename": filename,
				"comfyui_path":        modelPath,
			}).Debug("matched checkpoint to ComfyUI LoRA model path")
			return modelPath, nil
		}
	}

	m.logger.WithFields(logrus.Fields{
		"checkpoint_filename": filename,
		"model_count":         len(models),
	}).Debug("no matching ComfyUI LoRA model found for checkpoint")
	return "", fmt.Errorf("checkpoint %s not found in ComfyUI LoRA models: %w", filename, ErrCheckpointNotResolved)
}
