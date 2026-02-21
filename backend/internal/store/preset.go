package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
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
	rows, err := s.db.Query("SELECT id, name, mapping, created_at, updated_at FROM presets ORDER BY name")
	if err != nil {
		return nil, fmt.Errorf("querying presets: %w", err)
	}
	defer rows.Close()

	var presets []model.Preset
	for rows.Next() {
		var e presetEntity
		if err := rows.Scan(&e.ID, &e.Name, &e.Mapping, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scanning preset row: %w", err)
		}
		p, err := entityToModel(e)
		if err != nil {
			return nil, err
		}
		presets = append(presets, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating presets: %w", err)
	}
	return presets, nil
}

// GetPreset returns a single preset by ID, or sql.ErrNoRows if not found.
func (s *Store) GetPreset(id string) (model.Preset, error) {
	var e presetEntity
	err := s.db.QueryRow(
		"SELECT id, name, mapping, created_at, updated_at FROM presets WHERE id = ?", id,
	).Scan(&e.ID, &e.Name, &e.Mapping, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		return model.Preset{}, err
	}
	return entityToModel(e)
}

// CreatePreset inserts a new preset.
func (s *Store) CreatePreset(p model.Preset) error {
	mappingBytes, err := modelMappingToJSON(p.Mapping)
	if err != nil {
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
		return fmt.Errorf("inserting preset: %w", err)
	}
	return nil
}

// UpdatePreset updates an existing preset's name and mapping. Returns
// sql.ErrNoRows if the preset does not exist.
func (s *Store) UpdatePreset(p model.Preset) error {
	mappingBytes, err := modelMappingToJSON(p.Mapping)
	if err != nil {
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
		return fmt.Errorf("updating preset: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeletePreset removes a preset by ID. Returns sql.ErrNoRows if the preset
// does not exist.
func (s *Store) DeletePreset(id string) error {
	result, err := s.db.Exec("DELETE FROM presets WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("deleting preset: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		return sql.ErrNoRows
	}
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
