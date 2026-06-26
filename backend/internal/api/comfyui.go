package api

import (
	"context"
	"errors"
	"fmt"
	"net"

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
		// R-016: surface ComfyUI failures with stable, documented codes instead of
		// masking outages as an empty result. The frontend treats both an empty
		// list and a thrown error as "ComfyUI unavailable" and falls back to its
		// static option lists, so this changes the status code (no longer an
		// unmapped 500) without degrading the UX.
		if isConnectionError(err) {
			return nil, gencomfyui.MakeServiceUnavailable(fmt.Errorf("ComfyUI unavailable: %w", err))
		}
		return nil, gencomfyui.MakeInternalError(fmt.Errorf("listing ComfyUI models: %w", err))
	}

	return &gencomfyui.ComfyUIModelsResult{
		Models: models,
	}, nil
}

// isConnectionError reports whether err (or any error it wraps) indicates the
// ComfyUI host was unreachable: a network-level error or a context
// deadline/cancellation. Such failures map to service_unavailable (503); all
// other failures (e.g. malformed responses) map to internal_error (500).
func isConnectionError(err error) bool {
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}
