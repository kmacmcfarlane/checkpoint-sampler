package service

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// PresetStore defines the persistence operations the preset service needs.
type PresetStore interface {
	ListPresets() ([]model.Preset, error)
	GetPreset(id string) (model.Preset, error)
	CreatePreset(p model.Preset) error
	UpdatePreset(p model.Preset) error
	DeletePreset(id string) error
}

// PresetService manages preset CRUD operations.
type PresetService struct {
	store PresetStore
}

// NewPresetService creates a PresetService backed by the given store.
func NewPresetService(store PresetStore) *PresetService {
	return &PresetService{store: store}
}

// List returns all presets.
func (s *PresetService) List() ([]model.Preset, error) {
	presets, err := s.store.ListPresets()
	if err != nil {
		return nil, fmt.Errorf("listing presets: %w", err)
	}
	if presets == nil {
		presets = []model.Preset{}
	}
	return presets, nil
}

// Create validates and persists a new preset, returning the created preset.
func (s *PresetService) Create(name string, mapping model.PresetMapping) (model.Preset, error) {
	if name == "" {
		return model.Preset{}, fmt.Errorf("preset name must not be empty")
	}
	now := time.Now().UTC()
	p := model.Preset{
		ID:        uuid.New().String(),
		Name:      name,
		Mapping:   mapping,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := s.store.CreatePreset(p); err != nil {
		return model.Preset{}, fmt.Errorf("creating preset: %w", err)
	}
	return p, nil
}

// Update modifies an existing preset's name and mapping.
func (s *PresetService) Update(id string, name string, mapping model.PresetMapping) (model.Preset, error) {
	if name == "" {
		return model.Preset{}, fmt.Errorf("preset name must not be empty")
	}
	existing, err := s.store.GetPreset(id)
	if err == sql.ErrNoRows {
		return model.Preset{}, fmt.Errorf("preset %s not found", id)
	}
	if err != nil {
		return model.Preset{}, fmt.Errorf("fetching preset: %w", err)
	}
	existing.Name = name
	existing.Mapping = mapping
	existing.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdatePreset(existing); err != nil {
		return model.Preset{}, fmt.Errorf("updating preset: %w", err)
	}
	return existing, nil
}

// Delete removes a preset by ID.
func (s *PresetService) Delete(id string) error {
	err := s.store.DeletePreset(id)
	if err == sql.ErrNoRows {
		return fmt.Errorf("preset %s not found", id)
	}
	if err != nil {
		return fmt.Errorf("deleting preset: %w", err)
	}
	return nil
}
