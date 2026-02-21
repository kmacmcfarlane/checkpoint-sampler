package model

import "time"

// Preset represents a saved dimension-to-role mapping configuration.
type Preset struct {
	ID        string
	Name      string
	Mapping   PresetMapping
	CreatedAt time.Time
	UpdatedAt time.Time
}

// PresetMapping defines the assignment of dimensions to UI roles.
type PresetMapping struct {
	X      string
	Y      string
	Slider string
	Combos []string
}
