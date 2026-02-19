package model

import "regexp"

// Config represents the application configuration.
type Config struct {
	Root         string
	Port         int
	IPAddress    string
	DBPath       string
	TrainingRuns []TrainingRunConfig
}

// TrainingRunConfig defines a training run for directory scanning.
type TrainingRunConfig struct {
	Name       string
	Pattern    *regexp.Regexp
	Dimensions []DimensionConfig
}

// DimensionConfig defines how to extract a dimension from directory names.
type DimensionConfig struct {
	Name    string
	Type    DimensionType
	Pattern *regexp.Regexp
}

// DimensionType indicates how dimension values are sorted.
type DimensionType string

const (
	DimensionTypeInt    DimensionType = "int"
	DimensionTypeString DimensionType = "string"
)
