package service

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
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
	store  PresetStore
	logger *logrus.Entry
}

// NewPresetService creates a PresetService backed by the given store.
func NewPresetService(store PresetStore, logger *logrus.Logger) *PresetService {
	return &PresetService{
		store:  store,
		logger: logger.WithField("component", "preset"),
	}
}

// List returns all presets.
func (s *PresetService) List() ([]model.Preset, error) {
	s.logger.Trace("entering List")
	defer s.logger.Trace("returning from List")

	presets, err := s.store.ListPresets()
	if err != nil {
		s.logger.WithError(err).Error("failed to list presets")
		return nil, fmt.Errorf("listing presets: %w", err)
	}
	s.logger.WithField("preset_count", len(presets)).Debug("presets retrieved from store")
	if presets == nil {
		presets = []model.Preset{}
	}
	return presets, nil
}

// Create validates and persists a new preset, returning the created preset.
func (s *PresetService) Create(name string, mapping model.PresetMapping) (model.Preset, error) {
	s.logger.WithField("preset_name", name).Trace("entering Create")
	defer s.logger.Trace("returning from Create")

	if name == "" {
		s.logger.Warn("preset name validation failed: name is empty")
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
		s.logger.WithFields(logrus.Fields{
			"preset_id":   p.ID,
			"preset_name": name,
			"error":       err.Error(),
		}).Error("failed to create preset")
		return model.Preset{}, fmt.Errorf("creating preset: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"preset_id":   p.ID,
		"preset_name": name,
	}).Info("preset created")
	return p, nil
}

// Update modifies an existing preset's name and mapping.
func (s *PresetService) Update(id string, name string, mapping model.PresetMapping) (model.Preset, error) {
	s.logger.WithFields(logrus.Fields{
		"preset_id":   id,
		"preset_name": name,
	}).Trace("entering Update")
	defer s.logger.Trace("returning from Update")

	if name == "" {
		s.logger.WithField("preset_id", id).Warn("preset name validation failed: name is empty")
		return model.Preset{}, fmt.Errorf("preset name must not be empty")
	}
	existing, err := s.store.GetPreset(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("preset_id", id).Debug("preset not found")
		return model.Preset{}, fmt.Errorf("preset %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": id,
			"error":     err.Error(),
		}).Error("failed to fetch preset for update")
		return model.Preset{}, fmt.Errorf("fetching preset: %w", err)
	}
	s.logger.WithField("preset_id", id).Debug("fetched existing preset from store")
	existing.Name = name
	existing.Mapping = mapping
	existing.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdatePreset(existing); err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id":   id,
			"preset_name": name,
			"error":       err.Error(),
		}).Error("failed to update preset")
		return model.Preset{}, fmt.Errorf("updating preset: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"preset_id":   id,
		"preset_name": name,
	}).Info("preset updated")
	return existing, nil
}

// Delete removes a preset by ID.
func (s *PresetService) Delete(id string) error {
	s.logger.WithField("preset_id", id).Trace("entering Delete")
	defer s.logger.Trace("returning from Delete")

	err := s.store.DeletePreset(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("preset_id", id).Debug("preset not found for deletion")
		return fmt.Errorf("preset %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": id,
			"error":     err.Error(),
		}).Error("failed to delete preset")
		return fmt.Errorf("deleting preset: %w", err)
	}
	s.logger.WithField("preset_id", id).Info("preset deleted")
	return nil
}
