package api

import (
	"context"

	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
)

// HealthService implements the generated health service interface.
type HealthService struct{}

// NewHealthService returns a new HealthService.
func NewHealthService() *HealthService {
	return &HealthService{}
}

// Check returns the health status of the service.
func (s *HealthService) Check(ctx context.Context) (*genhealth.HealthResult, error) {
	return &genhealth.HealthResult{Status: "ok"}, nil
}
