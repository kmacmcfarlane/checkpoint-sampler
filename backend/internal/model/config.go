package model

// Config represents the application configuration.
type Config struct {
	CheckpointDirs []string
	SampleDir      string
	Port           int
	IPAddress      string
	DBPath         string
}

// DimensionType indicates how dimension values are sorted.
type DimensionType string

const (
	DimensionTypeInt    DimensionType = "int"
	DimensionTypeString DimensionType = "string"
)
