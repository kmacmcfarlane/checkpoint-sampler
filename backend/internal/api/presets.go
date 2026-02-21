package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/presets"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// PresetsService implements the generated presets service interface.
type PresetsService struct {
	svc *service.PresetService
}

// NewPresetsService returns a new PresetsService.
func NewPresetsService(svc *service.PresetService) *PresetsService {
	return &PresetsService{svc: svc}
}

// List returns all saved presets.
func (s *PresetsService) List(ctx context.Context) ([]*genpresets.PresetResponse, error) {
	presets, err := s.svc.List()
	if err != nil {
		return nil, fmt.Errorf("listing presets: %w", err)
	}
	result := make([]*genpresets.PresetResponse, len(presets))
	for i, p := range presets {
		result[i] = presetToResponse(p)
	}
	return result, nil
}

// Create creates a new preset.
func (s *PresetsService) Create(ctx context.Context, p *genpresets.CreatePresetPayload) (*genpresets.PresetResponse, error) {
	mapping := payloadToMapping(p.Mapping)
	preset, err := s.svc.Create(p.Name, mapping)
	if err != nil {
		return nil, genpresets.MakeInvalidPayload(fmt.Errorf("creating preset: %w", err))
	}
	return presetToResponse(preset), nil
}

// Update modifies an existing preset.
func (s *PresetsService) Update(ctx context.Context, p *genpresets.UpdatePresetPayload) (*genpresets.PresetResponse, error) {
	mapping := payloadToMapping(p.Mapping)
	preset, err := s.svc.Update(p.ID, p.Name, mapping)
	if err != nil {
		if isNotFound(err) {
			return nil, genpresets.MakeNotFound(err)
		}
		return nil, genpresets.MakeInvalidPayload(fmt.Errorf("updating preset: %w", err))
	}
	return presetToResponse(preset), nil
}

// Delete removes a preset.
func (s *PresetsService) Delete(ctx context.Context, p *genpresets.DeletePayload) error {
	err := s.svc.Delete(p.ID)
	if err != nil {
		if isNotFound(err) {
			return genpresets.MakeNotFound(err)
		}
		return fmt.Errorf("deleting preset: %w", err)
	}
	return nil
}

func presetToResponse(p model.Preset) *genpresets.PresetResponse {
	mapping := &genpresets.PresetMappingResponse{
		Combos: p.Mapping.Combos,
	}
	if mapping.Combos == nil {
		mapping.Combos = []string{}
	}
	if p.Mapping.X != "" {
		mapping.X = &p.Mapping.X
	}
	if p.Mapping.Y != "" {
		mapping.Y = &p.Mapping.Y
	}
	if p.Mapping.Slider != "" {
		mapping.Slider = &p.Mapping.Slider
	}
	return &genpresets.PresetResponse{
		ID:        p.ID,
		Name:      p.Name,
		Mapping:   mapping,
		CreatedAt: p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt: p.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func payloadToMapping(p *genpresets.PresetMappingPayload) model.PresetMapping {
	m := model.PresetMapping{
		Combos: p.Combos,
	}
	if p.X != nil {
		m.X = *p.X
	}
	if p.Y != nil {
		m.Y = *p.Y
	}
	if p.Slider != nil {
		m.Slider = *p.Slider
	}
	return m
}

func isNotFound(err error) bool {
	return err != nil && strings.Contains(err.Error(), "not found")
}
