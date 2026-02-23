package api

import (
	"context"
	"fmt"

	genworkflows "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/workflows"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// WorkflowService implements the workflows Goa service interface.
type WorkflowService struct {
	loader  WorkflowLoader
	enabled bool
}

// WorkflowLoader defines the interface for loading workflow templates.
type WorkflowLoader interface {
	List(ctx context.Context) ([]model.WorkflowTemplate, error)
	Get(ctx context.Context, name string) (model.WorkflowTemplate, error)
}

// NewWorkflowService creates a new workflows service.
// If loader is nil, the service is disabled.
func NewWorkflowService(loader WorkflowLoader) *WorkflowService {
	enabled := loader != nil
	return &WorkflowService{
		loader:  loader,
		enabled: enabled,
	}
}

// List implements the list endpoint.
func (s *WorkflowService) List(ctx context.Context) ([]*genworkflows.WorkflowSummary, error) {
	if !s.enabled {
		return []*genworkflows.WorkflowSummary{}, nil
	}

	templates, err := s.loader.List(ctx)
	if err != nil {
		return nil, genworkflows.MakeInternalError(err)
	}

	summaries := make([]*genworkflows.WorkflowSummary, len(templates))
	for i, tmpl := range templates {
		summaries[i] = &genworkflows.WorkflowSummary{
			Name:            tmpl.Name,
			ValidationState: string(tmpl.ValidationState),
			Roles:           tmpl.Roles,
			Warnings:        tmpl.Warnings,
		}
	}

	return summaries, nil
}

// Show implements the show endpoint.
func (s *WorkflowService) Show(ctx context.Context, payload *genworkflows.ShowPayload) (*genworkflows.WorkflowDetails, error) {
	if !s.enabled {
		return nil, genworkflows.MakeNotFound(fmt.Errorf("workflow not found: %s", payload.Name))
	}

	tmpl, err := s.loader.Get(ctx, payload.Name)
	if err != nil {
		return nil, genworkflows.MakeNotFound(err)
	}

	return &genworkflows.WorkflowDetails{
		Name:            tmpl.Name,
		ValidationState: string(tmpl.ValidationState),
		Roles:           tmpl.Roles,
		Warnings:        tmpl.Warnings,
		Workflow:        tmpl.Workflow,
	}, nil
}
