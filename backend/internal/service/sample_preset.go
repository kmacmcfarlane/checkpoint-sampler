package service

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// SamplePresetStore defines the persistence operations the sample preset service needs.
type SamplePresetStore interface {
	ListSamplePresets() ([]model.SamplePreset, error)
	GetSamplePreset(id string) (model.SamplePreset, error)
	CreateSamplePreset(p model.SamplePreset) error
	UpdateSamplePreset(p model.SamplePreset) error
	DeleteSamplePreset(id string) error
}

// SamplePresetService manages sample preset CRUD operations.
type SamplePresetService struct {
	store  SamplePresetStore
	logger *logrus.Entry
}

// NewSamplePresetService creates a SamplePresetService backed by the given store.
func NewSamplePresetService(store SamplePresetStore, logger *logrus.Logger) *SamplePresetService {
	return &SamplePresetService{
		store:  store,
		logger: logger.WithField("component", "sample_preset"),
	}
}

// List returns all sample presets.
func (s *SamplePresetService) List() ([]model.SamplePreset, error) {
	s.logger.Trace("entering List")
	defer s.logger.Trace("returning from List")

	presets, err := s.store.ListSamplePresets()
	if err != nil {
		s.logger.WithError(err).Error("failed to list sample presets")
		return nil, fmt.Errorf("listing sample presets: %w", err)
	}
	s.logger.WithField("preset_count", len(presets)).Debug("sample presets retrieved from store")
	if presets == nil {
		presets = []model.SamplePreset{}
	}
	return presets, nil
}

// Create validates and persists a new sample preset, returning the created preset.
func (s *SamplePresetService) Create(name string, prompts []model.NamedPrompt, negativePrompt string, steps []int, cfgs []float64, pairs []model.SamplerSchedulerPair, seeds []int64, width int, height int) (model.SamplePreset, error) {
	s.logger.WithField("sample_preset_name", name).Trace("entering Create")
	defer s.logger.Trace("returning from Create")

	if err := s.validate(name, prompts, steps, cfgs, pairs, seeds, width, height); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_name": name,
			"error":              err.Error(),
		}).Warn("sample preset validation failed")
		return model.SamplePreset{}, err
	}

	now := time.Now().UTC()
	p := model.SamplePreset{
		ID:                    uuid.New().String(),
		Name:                  name,
		Prompts:               prompts,
		NegativePrompt:        negativePrompt,
		Steps:                 steps,
		CFGs:                  cfgs,
		SamplerSchedulerPairs: pairs,
		Seeds:                 seeds,
		Width:                 width,
		Height:                height,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := s.store.CreateSamplePreset(p); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id":   p.ID,
			"sample_preset_name": name,
			"error":              err.Error(),
		}).Error("failed to create sample preset")
		return model.SamplePreset{}, fmt.Errorf("creating sample preset: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":      p.ID,
		"sample_preset_name":    name,
		"images_per_checkpoint": p.ImagesPerCheckpoint(),
	}).Info("sample preset created")
	return p, nil
}

// Update modifies an existing sample preset.
func (s *SamplePresetService) Update(id string, name string, prompts []model.NamedPrompt, negativePrompt string, steps []int, cfgs []float64, pairs []model.SamplerSchedulerPair, seeds []int64, width int, height int) (model.SamplePreset, error) {
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":   id,
		"sample_preset_name": name,
	}).Trace("entering Update")
	defer s.logger.Trace("returning from Update")

	if err := s.validate(name, prompts, steps, cfgs, pairs, seeds, width, height); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": id,
			"error":            err.Error(),
		}).Warn("sample preset validation failed")
		return model.SamplePreset{}, err
	}

	existing, err := s.store.GetSamplePreset(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_preset_id", id).Debug("sample preset not found")
		return model.SamplePreset{}, fmt.Errorf("sample preset %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": id,
			"error":            err.Error(),
		}).Error("failed to fetch sample preset for update")
		return model.SamplePreset{}, fmt.Errorf("fetching sample preset: %w", err)
	}
	s.logger.WithField("sample_preset_id", id).Debug("fetched existing sample preset from store")

	existing.Name = name
	existing.Prompts = prompts
	existing.NegativePrompt = negativePrompt
	existing.Steps = steps
	existing.CFGs = cfgs
	existing.SamplerSchedulerPairs = pairs
	existing.Seeds = seeds
	existing.Width = width
	existing.Height = height
	existing.UpdatedAt = time.Now().UTC()

	if err := s.store.UpdateSamplePreset(existing); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id":   id,
			"sample_preset_name": name,
			"error":              err.Error(),
		}).Error("failed to update sample preset")
		return model.SamplePreset{}, fmt.Errorf("updating sample preset: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":      id,
		"sample_preset_name":    name,
		"images_per_checkpoint": existing.ImagesPerCheckpoint(),
	}).Info("sample preset updated")
	return existing, nil
}

// Delete removes a sample preset by ID.
func (s *SamplePresetService) Delete(id string) error {
	s.logger.WithField("sample_preset_id", id).Trace("entering Delete")
	defer s.logger.Trace("returning from Delete")

	err := s.store.DeleteSamplePreset(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("sample_preset_id", id).Debug("sample preset not found for deletion")
		return fmt.Errorf("sample preset %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": id,
			"error":            err.Error(),
		}).Error("failed to delete sample preset")
		return fmt.Errorf("deleting sample preset: %w", err)
	}
	s.logger.WithField("sample_preset_id", id).Info("sample preset deleted")
	return nil
}

// validate checks that a sample preset's fields meet the requirements.
func (s *SamplePresetService) validate(name string, prompts []model.NamedPrompt, steps []int, cfgs []float64, pairs []model.SamplerSchedulerPair, seeds []int64, width int, height int) error {
	if name == "" {
		return fmt.Errorf("preset name must not be empty")
	}
	if len(prompts) == 0 {
		return fmt.Errorf("at least one prompt is required")
	}
	for i, p := range prompts {
		if p.Name == "" {
			return fmt.Errorf("prompt %d name must not be empty", i)
		}
		if p.Text == "" {
			return fmt.Errorf("prompt %d text must not be empty", i)
		}
	}
	if len(steps) == 0 {
		return fmt.Errorf("at least one step count is required")
	}
	for i, step := range steps {
		if step <= 0 {
			return fmt.Errorf("step %d must be positive", i)
		}
	}
	if len(cfgs) == 0 {
		return fmt.Errorf("at least one CFG value is required")
	}
	for i, cfg := range cfgs {
		if cfg <= 0 {
			return fmt.Errorf("CFG %d must be positive", i)
		}
	}
	if len(pairs) == 0 {
		return fmt.Errorf("at least one sampler/scheduler pair is required")
	}
	for i, pair := range pairs {
		if pair.Sampler == "" {
			return fmt.Errorf("pair %d sampler must not be empty", i)
		}
		if pair.Scheduler == "" {
			return fmt.Errorf("pair %d scheduler must not be empty", i)
		}
	}
	if len(seeds) == 0 {
		return fmt.Errorf("at least one seed is required")
	}
	if width <= 0 {
		return fmt.Errorf("width must be positive")
	}
	if height <= 0 {
		return fmt.Errorf("height must be positive")
	}
	return nil
}
