package api

import (
	"context"
	"fmt"

	gendemo "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/demo"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// DemoAPIService implements the generated demo service interface.
type DemoAPIService struct {
	svc *service.DemoService
}

// NewDemoAPIService returns a new DemoAPIService.
func NewDemoAPIService(svc *service.DemoService) *DemoAPIService {
	return &DemoAPIService{svc: svc}
}

// Status returns whether the demo dataset is installed.
func (s *DemoAPIService) Status(ctx context.Context) (*gendemo.DemoStatusResponse, error) {
	status := s.svc.Status()
	return &gendemo.DemoStatusResponse{Installed: status.Installed}, nil
}

// Install creates the demo dataset and seeds the demo preset.
func (s *DemoAPIService) Install(ctx context.Context) (*gendemo.DemoStatusResponse, error) {
	if err := s.svc.Install(); err != nil {
		return nil, gendemo.MakeInternalError(fmt.Errorf("installing demo: %w", err))
	}
	status := s.svc.Status()
	return &gendemo.DemoStatusResponse{Installed: status.Installed}, nil
}

// Uninstall removes the demo dataset and demo preset.
func (s *DemoAPIService) Uninstall(ctx context.Context) (*gendemo.DemoStatusResponse, error) {
	if err := s.svc.Uninstall(); err != nil {
		return nil, gendemo.MakeInternalError(fmt.Errorf("uninstalling demo: %w", err))
	}
	status := s.svc.Status()
	return &gendemo.DemoStatusResponse{Installed: status.Installed}, nil
}
