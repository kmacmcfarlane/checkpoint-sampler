package api

import (
	"context"
	"fmt"

	gendemo "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/demo"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// DemoAPIService implements the generated demo service interface.
type DemoAPIService struct {
	svc     *service.DemoService
	fsState *service.FSState
}

// NewDemoAPIService returns a new DemoAPIService.
func NewDemoAPIService(svc *service.DemoService) *DemoAPIService {
	return &DemoAPIService{svc: svc}
}

// SetFSState configures the service to trigger an FSState refresh after
// install/uninstall so the training run list is immediately up to date.
func (s *DemoAPIService) SetFSState(state *service.FSState) {
	s.fsState = state
}

// Status returns whether the demo dataset is installed.
func (s *DemoAPIService) Status(ctx context.Context) (*gendemo.DemoStatusResponse, error) {
	status := s.svc.Status()
	return &gendemo.DemoStatusResponse{Installed: status.Installed}, nil
}

// Install creates the demo dataset and seeds the demo preset.
// If an FSState is configured, it triggers an immediate refresh so the
// training run list reflects the newly installed demo data without waiting
// for the filesystem watcher's debounce window.
func (s *DemoAPIService) Install(ctx context.Context) (*gendemo.DemoStatusResponse, error) {
	if err := s.svc.Install(); err != nil {
		return nil, gendemo.MakeInternalError(fmt.Errorf("installing demo: %w", err))
	}
	s.refreshFSState()
	status := s.svc.Status()
	return &gendemo.DemoStatusResponse{Installed: status.Installed}, nil
}

// Uninstall removes the demo dataset and demo preset.
// If an FSState is configured, it triggers an immediate refresh so the
// training run list reflects the removal without waiting for the filesystem
// watcher's debounce window.
func (s *DemoAPIService) Uninstall(ctx context.Context) (*gendemo.DemoStatusResponse, error) {
	if err := s.svc.Uninstall(); err != nil {
		return nil, gendemo.MakeInternalError(fmt.Errorf("uninstalling demo: %w", err))
	}
	s.refreshFSState()
	status := s.svc.Status()
	return &gendemo.DemoStatusResponse{Installed: status.Installed}, nil
}

// refreshFSState triggers an immediate FSState refresh if configured.
// Errors are logged but not propagated — the demo operation itself succeeded.
func (s *DemoAPIService) refreshFSState() {
	if s.fsState != nil {
		_ = s.fsState.Populate()
	}
}
