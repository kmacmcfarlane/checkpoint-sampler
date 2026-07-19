package api

import (
	"context"

	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
)

// HealthService implements the generated health service interface.
type HealthService struct {
	maxStudyItems  int
	checkpointDirs []string
}

// NewHealthService returns a new HealthService. maxStudyItems is the configured
// maximum number of work items per study/job, exposed to the frontend via the
// config endpoint so the launch dialog can validate totals before submission.
// checkpointDirs is the configured list of checkpoint directories (S-173),
// surfaced so the training run selector's empty state can point newcomers at
// the exact paths the backend is scanning.
func NewHealthService(maxStudyItems int, checkpointDirs []string) *HealthService {
	return &HealthService{maxStudyItems: maxStudyItems, checkpointDirs: checkpointDirs}
}

// Check returns the health status of the service.
func (s *HealthService) Check(ctx context.Context) (*genhealth.HealthResult, error) {
	return &genhealth.HealthResult{Status: "ok"}, nil
}

// Config returns UI-relevant configuration limits for the frontend.
func (s *HealthService) Config(ctx context.Context) (*genhealth.ConfigResult, error) {
	return &genhealth.ConfigResult{MaxStudyItems: s.maxStudyItems, CheckpointDirs: s.checkpointDirs}, nil
}
