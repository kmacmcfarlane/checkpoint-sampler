package model

// Config represents the application configuration.
type Config struct {
	CheckpointDirs []string
	SampleDir      string
	Port           int
	IPAddress      string
	DBPath         string
	ComfyUI        *ComfyUIConfig
}

// ComfyUIConfig represents the ComfyUI integration configuration.
// This section is optional; if absent, ComfyUI features are disabled.
type ComfyUIConfig struct {
	Host        string
	Port        int
	WorkflowDir string
}

// DimensionType indicates how dimension values are sorted.
type DimensionType string

const (
	DimensionTypeInt    DimensionType = "int"
	DimensionTypeString DimensionType = "string"
)
