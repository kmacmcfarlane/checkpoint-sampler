package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// samplePresetEntity is the persistence representation of a sample preset.
type samplePresetEntity struct {
	ID             string
	Name           string
	Prompts        string // JSON
	NegativePrompt string
	Steps          string // JSON
	CFGs           string // JSON
	Samplers       string // JSON
	Schedulers     string // JSON
	Seeds          string // JSON
	Width          int
	Height         int
	CreatedAt      string // RFC3339
	UpdatedAt      string // RFC3339
}

// promptJSON is the JSON shape for named prompts.
type promptJSON struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// ListSamplePresets returns all sample presets ordered by name.
func (s *Store) ListSamplePresets() ([]model.SamplePreset, error) {
	s.logger.Trace("entering ListSamplePresets")
	defer s.logger.Trace("returning from ListSamplePresets")

	rows, err := s.db.Query(`SELECT id, name, prompts, negative_prompt, steps, cfgs, samplers, schedulers, seeds, width, height, created_at, updated_at
		FROM sample_presets ORDER BY name`)
	if err != nil {
		s.logger.WithError(err).Error("failed to query sample presets")
		return nil, fmt.Errorf("querying sample presets: %w", err)
	}
	defer rows.Close()

	var presets []model.SamplePreset
	for rows.Next() {
		var e samplePresetEntity
		if err := rows.Scan(&e.ID, &e.Name, &e.Prompts, &e.NegativePrompt, &e.Steps, &e.CFGs, &e.Samplers, &e.Schedulers, &e.Seeds, &e.Width, &e.Height, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan sample preset row")
			return nil, fmt.Errorf("scanning sample preset row: %w", err)
		}
		p, err := samplePresetEntityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		presets = append(presets, p)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating sample presets")
		return nil, fmt.Errorf("iterating sample presets: %w", err)
	}
	s.logger.WithField("preset_count", len(presets)).Debug("listed sample presets from database")
	return presets, nil
}

// GetSamplePreset returns a single sample preset by ID, or sql.ErrNoRows if not found.
func (s *Store) GetSamplePreset(id string) (model.SamplePreset, error) {
	s.logger.WithField("sample_preset_id", id).Trace("entering GetSamplePreset")
	defer s.logger.Trace("returning from GetSamplePreset")

	var e samplePresetEntity
	err := s.db.QueryRow(
		`SELECT id, name, prompts, negative_prompt, steps, cfgs, samplers, schedulers, seeds, width, height, created_at, updated_at
		FROM sample_presets WHERE id = ?`, id,
	).Scan(&e.ID, &e.Name, &e.Prompts, &e.NegativePrompt, &e.Steps, &e.CFGs, &e.Samplers, &e.Schedulers, &e.Seeds, &e.Width, &e.Height, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			s.logger.WithField("sample_preset_id", id).Debug("sample preset not found in database")
		} else {
			s.logger.WithFields(logrus.Fields{
				"sample_preset_id": id,
				"error":            err.Error(),
			}).Error("failed to query sample preset")
		}
		return model.SamplePreset{}, err
	}
	s.logger.WithField("sample_preset_id", id).Debug("fetched sample preset from database")
	return samplePresetEntityToModel(e)
}

// CreateSamplePreset inserts a new sample preset.
func (s *Store) CreateSamplePreset(p model.SamplePreset) error {
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":   p.ID,
		"sample_preset_name": p.Name,
	}).Trace("entering CreateSamplePreset")
	defer s.logger.Trace("returning from CreateSamplePreset")

	entity, err := samplePresetModelToEntity(p)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": p.ID,
			"error":            err.Error(),
		}).Error("failed to convert model to entity")
		return err
	}

	_, err = s.db.Exec(
		`INSERT INTO sample_presets (id, name, prompts, negative_prompt, steps, cfgs, samplers, schedulers, seeds, width, height, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entity.ID,
		entity.Name,
		entity.Prompts,
		entity.NegativePrompt,
		entity.Steps,
		entity.CFGs,
		entity.Samplers,
		entity.Schedulers,
		entity.Seeds,
		entity.Width,
		entity.Height,
		entity.CreatedAt,
		entity.UpdatedAt,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id":   p.ID,
			"sample_preset_name": p.Name,
			"error":              err.Error(),
		}).Error("failed to insert sample preset into database")
		return fmt.Errorf("inserting sample preset: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":   p.ID,
		"sample_preset_name": p.Name,
	}).Info("inserted sample preset into database")
	return nil
}

// UpdateSamplePreset updates an existing sample preset. Returns
// sql.ErrNoRows if the preset does not exist.
func (s *Store) UpdateSamplePreset(p model.SamplePreset) error {
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":   p.ID,
		"sample_preset_name": p.Name,
	}).Trace("entering UpdateSamplePreset")
	defer s.logger.Trace("returning from UpdateSamplePreset")

	entity, err := samplePresetModelToEntity(p)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": p.ID,
			"error":            err.Error(),
		}).Error("failed to convert model to entity")
		return err
	}

	result, err := s.db.Exec(
		`UPDATE sample_presets SET name = ?, prompts = ?, negative_prompt = ?, steps = ?, cfgs = ?, samplers = ?, schedulers = ?, seeds = ?, width = ?, height = ?, updated_at = ?
		WHERE id = ?`,
		entity.Name,
		entity.Prompts,
		entity.NegativePrompt,
		entity.Steps,
		entity.CFGs,
		entity.Samplers,
		entity.Schedulers,
		entity.Seeds,
		entity.Width,
		entity.Height,
		entity.UpdatedAt,
		entity.ID,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id":   p.ID,
			"sample_preset_name": p.Name,
			"error":              err.Error(),
		}).Error("failed to update sample preset in database")
		return fmt.Errorf("updating sample preset: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": p.ID,
			"error":            err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("sample_preset_id", p.ID).Debug("no rows affected, sample preset not found")
		return sql.ErrNoRows
	}
	s.logger.WithFields(logrus.Fields{
		"sample_preset_id":   p.ID,
		"sample_preset_name": p.Name,
	}).Info("updated sample preset in database")
	return nil
}

// DeleteSamplePreset removes a sample preset by ID. Returns sql.ErrNoRows if the preset
// does not exist.
func (s *Store) DeleteSamplePreset(id string) error {
	s.logger.WithField("sample_preset_id", id).Trace("entering DeleteSamplePreset")
	defer s.logger.Trace("returning from DeleteSamplePreset")

	result, err := s.db.Exec("DELETE FROM sample_presets WHERE id = ?", id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": id,
			"error":            err.Error(),
		}).Error("failed to delete sample preset from database")
		return fmt.Errorf("deleting sample preset: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_preset_id": id,
			"error":            err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("sample_preset_id", id).Debug("no rows affected, sample preset not found")
		return sql.ErrNoRows
	}
	s.logger.WithField("sample_preset_id", id).Info("deleted sample preset from database")
	return nil
}

func samplePresetEntityToModel(e samplePresetEntity) (model.SamplePreset, error) {
	var prompts []promptJSON
	if err := json.Unmarshal([]byte(e.Prompts), &prompts); err != nil {
		return model.SamplePreset{}, fmt.Errorf("unmarshaling prompts: %w", err)
	}

	var steps []int
	if err := json.Unmarshal([]byte(e.Steps), &steps); err != nil {
		return model.SamplePreset{}, fmt.Errorf("unmarshaling steps: %w", err)
	}

	var cfgs []float64
	if err := json.Unmarshal([]byte(e.CFGs), &cfgs); err != nil {
		return model.SamplePreset{}, fmt.Errorf("unmarshaling cfgs: %w", err)
	}

	var samplers []string
	if err := json.Unmarshal([]byte(e.Samplers), &samplers); err != nil {
		return model.SamplePreset{}, fmt.Errorf("unmarshaling samplers: %w", err)
	}

	var schedulers []string
	if err := json.Unmarshal([]byte(e.Schedulers), &schedulers); err != nil {
		return model.SamplePreset{}, fmt.Errorf("unmarshaling schedulers: %w", err)
	}

	var seeds []int64
	if err := json.Unmarshal([]byte(e.Seeds), &seeds); err != nil {
		return model.SamplePreset{}, fmt.Errorf("unmarshaling seeds: %w", err)
	}

	createdAt, err := time.Parse(time.RFC3339, e.CreatedAt)
	if err != nil {
		return model.SamplePreset{}, fmt.Errorf("parsing created_at: %w", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, e.UpdatedAt)
	if err != nil {
		return model.SamplePreset{}, fmt.Errorf("parsing updated_at: %w", err)
	}

	namedPrompts := make([]model.NamedPrompt, len(prompts))
	for i, p := range prompts {
		namedPrompts[i] = model.NamedPrompt{
			Name: p.Name,
			Text: p.Text,
		}
	}

	return model.SamplePreset{
		ID:             e.ID,
		Name:           e.Name,
		Prompts:        namedPrompts,
		NegativePrompt: e.NegativePrompt,
		Steps:          steps,
		CFGs:           cfgs,
		Samplers:       samplers,
		Schedulers:     schedulers,
		Seeds:          seeds,
		Width:          e.Width,
		Height:         e.Height,
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}, nil
}

func samplePresetModelToEntity(p model.SamplePreset) (samplePresetEntity, error) {
	prompts := make([]promptJSON, len(p.Prompts))
	for i, np := range p.Prompts {
		prompts[i] = promptJSON{
			Name: np.Name,
			Text: np.Text,
		}
	}

	promptsBytes, err := json.Marshal(prompts)
	if err != nil {
		return samplePresetEntity{}, fmt.Errorf("marshaling prompts: %w", err)
	}

	stepsBytes, err := json.Marshal(p.Steps)
	if err != nil {
		return samplePresetEntity{}, fmt.Errorf("marshaling steps: %w", err)
	}

	cfgsBytes, err := json.Marshal(p.CFGs)
	if err != nil {
		return samplePresetEntity{}, fmt.Errorf("marshaling cfgs: %w", err)
	}

	samplersBytes, err := json.Marshal(p.Samplers)
	if err != nil {
		return samplePresetEntity{}, fmt.Errorf("marshaling samplers: %w", err)
	}

	schedulersBytes, err := json.Marshal(p.Schedulers)
	if err != nil {
		return samplePresetEntity{}, fmt.Errorf("marshaling schedulers: %w", err)
	}

	seedsBytes, err := json.Marshal(p.Seeds)
	if err != nil {
		return samplePresetEntity{}, fmt.Errorf("marshaling seeds: %w", err)
	}

	return samplePresetEntity{
		ID:             p.ID,
		Name:           p.Name,
		Prompts:        string(promptsBytes),
		NegativePrompt: p.NegativePrompt,
		Steps:          string(stepsBytes),
		CFGs:           string(cfgsBytes),
		Samplers:       string(samplersBytes),
		Schedulers:     string(schedulersBytes),
		Seeds:          string(seedsBytes),
		Width:          p.Width,
		Height:         p.Height,
		CreatedAt:      p.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:      p.UpdatedAt.UTC().Format(time.RFC3339),
	}, nil
}
