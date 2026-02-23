package api

import (
	"context"

	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// ComfyUIHealthChecker defines the interface for checking ComfyUI health.
type ComfyUIHealthChecker interface {
	HealthCheck(ctx context.Context) error
}

// ComfyUIModelLister defines the interface for listing ComfyUI models.
type ComfyUIModelLister interface {
	GetModels(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error)
}

// ComfyUIService implements the generated comfyui service interface.
type ComfyUIService struct {
	healthChecker ComfyUIHealthChecker
	modelLister   ComfyUIModelLister
	enabled       bool
}

// NewComfyUIService creates a new ComfyUI service.
// If healthChecker and modelLister are nil, the service is disabled.
func NewComfyUIService(healthChecker ComfyUIHealthChecker, modelLister ComfyUIModelLister) *ComfyUIService {
	enabled := healthChecker != nil && modelLister != nil
	return &ComfyUIService{
		healthChecker: healthChecker,
		modelLister:   modelLister,
		enabled:       enabled,
	}
}

// Status returns the connection status of ComfyUI.
func (s *ComfyUIService) Status(ctx context.Context) (*gencomfyui.ComfyUIStatusResult, error) {
	if !s.enabled {
		return &gencomfyui.ComfyUIStatusResult{
			Connected: false,
			Enabled:   false,
		}, nil
	}

	// Try to perform a health check
	err := s.healthChecker.HealthCheck(ctx)
	connected := err == nil

	return &gencomfyui.ComfyUIStatusResult{
		Connected: connected,
		Enabled:   true,
	}, nil
}

// Models returns the list of available models for the specified type.
func (s *ComfyUIService) Models(ctx context.Context, p *gencomfyui.ModelsPayload) (*gencomfyui.ComfyUIModelsResult, error) {
	if !s.enabled {
		return &gencomfyui.ComfyUIModelsResult{
			Models: []string{},
		}, nil
	}

	modelType := service.ComfyUIModelType(p.Type)
	models, err := s.modelLister.GetModels(ctx, modelType)
	if err != nil {
		// Return empty list on error to avoid breaking the UI
		return &gencomfyui.ComfyUIModelsResult{
			Models: []string{},
		}, nil
	}

	return &gencomfyui.ComfyUIModelsResult{
		Models: models,
	}, nil
}
