package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// presetEntity is the persistence representation of a preset.
type presetEntity struct {
	ID        string
	Name      string
	Mapping   string // JSON
	CreatedAt string // RFC3339
	UpdatedAt string // RFC3339
}

// mappingJSON is the JSON shape stored in the mapping column.
type mappingJSON struct {
	X      string   `json:"x,omitempty"`
	Y      string   `json:"y,omitempty"`
	Slider string   `json:"slider,omitempty"`
	Combos []string `json:"combos"`
}

// ListPresets returns all presets ordered by name.
func (s *Store) ListPresets() ([]model.Preset, error) {
	s.logger.Trace("entering ListPresets")
	defer s.logger.Trace("returning from ListPresets")

	rows, err := s.db.Query("SELECT id, name, mapping, created_at, updated_at FROM presets ORDER BY name")
	if err != nil {
		s.logger.WithError(err).Error("failed to query presets")
		return nil, fmt.Errorf("querying presets: %w", err)
	}
	defer rows.Close()

	var presets []model.Preset
	for rows.Next() {
		var e presetEntity
		if err := rows.Scan(&e.ID, &e.Name, &e.Mapping, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan preset row")
			return nil, fmt.Errorf("scanning preset row: %w", err)
		}
		p, err := entityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		presets = append(presets, p)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating presets")
		return nil, fmt.Errorf("iterating presets: %w", err)
	}
	s.logger.WithField("preset_count", len(presets)).Debug("listed presets from database")
	return presets, nil
}

// GetPreset returns a single preset by ID, or sql.ErrNoRows if not found.
func (s *Store) GetPreset(id string) (model.Preset, error) {
	s.logger.WithField("preset_id", id).Trace("entering GetPreset")
	defer s.logger.Trace("returning from GetPreset")

	var e presetEntity
	err := s.db.QueryRow(
		"SELECT id, name, mapping, created_at, updated_at FROM presets WHERE id = ?", id,
	).Scan(&e.ID, &e.Name, &e.Mapping, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			s.logger.WithField("preset_id", id).Debug("preset not found in database")
		} else {
			s.logger.WithFields(logrus.Fields{
				"preset_id": id,
				"error":     err.Error(),
			}).Error("failed to query preset")
		}
		return model.Preset{}, err
	}
	s.logger.WithField("preset_id", id).Debug("fetched preset from database")
	return entityToModel(e)
}

// CreatePreset inserts a new preset.
func (s *Store) CreatePreset(p model.Preset) error {
	s.logger.WithFields(logrus.Fields{
		"preset_id":   p.ID,
		"preset_name": p.Name,
	}).Trace("entering CreatePreset")
	defer s.logger.Trace("returning from CreatePreset")

	mappingBytes, err := modelMappingToJSON(p.Mapping)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": p.ID,
			"error":     err.Error(),
		}).Error("failed to marshal preset mapping")
		return err
	}
	_, err = s.db.Exec(
		"INSERT INTO presets (id, name, mapping, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
		p.ID,
		p.Name,
		string(mappingBytes),
		p.CreatedAt.UTC().Format(time.RFC3339),
		p.UpdatedAt.UTC().Format(time.RFC3339),
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id":   p.ID,
			"preset_name": p.Name,
			"error":       err.Error(),
		}).Error("failed to insert preset into database")
		return fmt.Errorf("inserting preset: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"preset_id":   p.ID,
		"preset_name": p.Name,
	}).Info("inserted preset into database")
	return nil
}

// UpdatePreset updates an existing preset's name and mapping. Returns
// sql.ErrNoRows if the preset does not exist.
func (s *Store) UpdatePreset(p model.Preset) error {
	s.logger.WithFields(logrus.Fields{
		"preset_id":   p.ID,
		"preset_name": p.Name,
	}).Trace("entering UpdatePreset")
	defer s.logger.Trace("returning from UpdatePreset")

	mappingBytes, err := modelMappingToJSON(p.Mapping)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": p.ID,
			"error":     err.Error(),
		}).Error("failed to marshal preset mapping")
		return err
	}
	result, err := s.db.Exec(
		"UPDATE presets SET name = ?, mapping = ?, updated_at = ? WHERE id = ?",
		p.Name,
		string(mappingBytes),
		p.UpdatedAt.UTC().Format(time.RFC3339),
		p.ID,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id":   p.ID,
			"preset_name": p.Name,
			"error":       err.Error(),
		}).Error("failed to update preset in database")
		return fmt.Errorf("updating preset: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": p.ID,
			"error":     err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("preset_id", p.ID).Debug("no rows affected, preset not found")
		return sql.ErrNoRows
	}
	s.logger.WithFields(logrus.Fields{
		"preset_id":   p.ID,
		"preset_name": p.Name,
	}).Info("updated preset in database")
	return nil
}

// DeletePreset removes a preset by ID. Returns sql.ErrNoRows if the preset
// does not exist.
func (s *Store) DeletePreset(id string) error {
	s.logger.WithField("preset_id", id).Trace("entering DeletePreset")
	defer s.logger.Trace("returning from DeletePreset")

	result, err := s.db.Exec("DELETE FROM presets WHERE id = ?", id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": id,
			"error":     err.Error(),
		}).Error("failed to delete preset from database")
		return fmt.Errorf("deleting preset: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"preset_id": id,
			"error":     err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("preset_id", id).Debug("no rows affected, preset not found")
		return sql.ErrNoRows
	}
	s.logger.WithField("preset_id", id).Info("deleted preset from database")
	return nil
}

func entityToModel(e presetEntity) (model.Preset, error) {
	var m mappingJSON
	if err := json.Unmarshal([]byte(e.Mapping), &m); err != nil {
		return model.Preset{}, fmt.Errorf("unmarshaling preset mapping: %w", err)
	}
	createdAt, err := time.Parse(time.RFC3339, e.CreatedAt)
	if err != nil {
		return model.Preset{}, fmt.Errorf("parsing created_at: %w", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, e.UpdatedAt)
	if err != nil {
		return model.Preset{}, fmt.Errorf("parsing updated_at: %w", err)
	}
	return model.Preset{
		ID:   e.ID,
		Name: e.Name,
		Mapping: model.PresetMapping{
			X:      m.X,
			Y:      m.Y,
			Slider: m.Slider,
			Combos: m.Combos,
		},
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}, nil
}

func modelMappingToJSON(m model.PresetMapping) ([]byte, error) {
	j := mappingJSON{
		X:      m.X,
		Y:      m.Y,
		Slider: m.Slider,
		Combos: m.Combos,
	}
	if j.Combos == nil {
		j.Combos = []string{}
	}
	data, err := json.Marshal(j)
	if err != nil {
		return nil, fmt.Errorf("marshaling preset mapping: %w", err)
	}
	return data, nil
}
