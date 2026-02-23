package api

import (
	"context"
	"fmt"
	"time"

	gensamplepresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_presets"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// SamplePresetsService implements the generated sample_presets service interface.
type SamplePresetsService struct {
	svc *service.SamplePresetService
}

// NewSamplePresetsService returns a new SamplePresetsService.
func NewSamplePresetsService(svc *service.SamplePresetService) *SamplePresetsService {
	return &SamplePresetsService{svc: svc}
}

// List returns all saved sample presets.
func (s *SamplePresetsService) List(ctx context.Context) ([]*gensamplepresets.SamplePresetResponse, error) {
	presets, err := s.svc.List()
	if err != nil {
		return nil, fmt.Errorf("listing sample presets: %w", err)
	}
	result := make([]*gensamplepresets.SamplePresetResponse, len(presets))
	for i, p := range presets {
		result[i] = samplePresetToResponse(p)
	}
	return result, nil
}

// Create creates a new sample preset.
func (s *SamplePresetsService) Create(ctx context.Context, p *gensamplepresets.CreateSamplePresetPayload) (*gensamplepresets.SamplePresetResponse, error) {
	prompts := make([]model.NamedPrompt, len(p.Prompts))
	for i, np := range p.Prompts {
		prompts[i] = model.NamedPrompt{
			Name: np.Name,
			Text: np.Text,
		}
	}

	preset, err := s.svc.Create(
		p.Name,
		prompts,
		p.NegativePrompt,
		p.Steps,
		p.Cfgs,
		p.Samplers,
		p.Schedulers,
		p.Seeds,
		p.Width,
		p.Height,
	)
	if err != nil {
		return nil, gensamplepresets.MakeInvalidPayload(fmt.Errorf("creating sample preset: %w", err))
	}
	return samplePresetToResponse(preset), nil
}

// Update modifies an existing sample preset.
func (s *SamplePresetsService) Update(ctx context.Context, p *gensamplepresets.UpdateSamplePresetPayload) (*gensamplepresets.SamplePresetResponse, error) {
	prompts := make([]model.NamedPrompt, len(p.Prompts))
	for i, np := range p.Prompts {
		prompts[i] = model.NamedPrompt{
			Name: np.Name,
			Text: np.Text,
		}
	}

	preset, err := s.svc.Update(
		p.ID,
		p.Name,
		prompts,
		p.NegativePrompt,
		p.Steps,
		p.Cfgs,
		p.Samplers,
		p.Schedulers,
		p.Seeds,
		p.Width,
		p.Height,
	)
	if err != nil {
		if isNotFound(err) {
			return nil, gensamplepresets.MakeNotFound(err)
		}
		return nil, gensamplepresets.MakeInvalidPayload(fmt.Errorf("updating sample preset: %w", err))
	}
	return samplePresetToResponse(preset), nil
}

// Delete removes a sample preset.
func (s *SamplePresetsService) Delete(ctx context.Context, p *gensamplepresets.DeletePayload) error {
	err := s.svc.Delete(p.ID)
	if err != nil {
		if isNotFound(err) {
			return gensamplepresets.MakeNotFound(err)
		}
		return fmt.Errorf("deleting sample preset: %w", err)
	}
	return nil
}

func samplePresetToResponse(p model.SamplePreset) *gensamplepresets.SamplePresetResponse {
	prompts := make([]*gensamplepresets.NamedPrompt, len(p.Prompts))
	for i, np := range p.Prompts {
		prompts[i] = &gensamplepresets.NamedPrompt{
			Name: np.Name,
			Text: np.Text,
		}
	}

	return &gensamplepresets.SamplePresetResponse{
		ID:                  p.ID,
		Name:                p.Name,
		Prompts:             prompts,
		NegativePrompt:      p.NegativePrompt,
		Steps:               p.Steps,
		Cfgs:                p.CFGs,
		Samplers:            p.Samplers,
		Schedulers:          p.Schedulers,
		Seeds:               p.Seeds,
		Width:               p.Width,
		Height:              p.Height,
		ImagesPerCheckpoint: p.ImagesPerCheckpoint(),
		CreatedAt:           p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
