package model

// Config represents the application configuration.
type Config struct {
	CheckpointDirs  []string
	SampleDir       string
	Port            int
	IPAddress       string
	DBPath          string
	ComfyUI         *ComfyUIConfig
	Thumbnails      *ThumbnailConfig
	WsPingInterval  int // seconds between WebSocket ping frames; 0 disables pings
}

// ComfyUIConfig represents the ComfyUI integration configuration.
// This section is optional; if absent, ComfyUI features are disabled.
type ComfyUIConfig struct {
	URL         string
	WorkflowDir string
}

// ThumbnailConfig holds thumbnail generation settings.
// Thumbnail generation is optional; if Enabled is false, no thumbnails are created.
type ThumbnailConfig struct {
	Enabled       bool
	MaxResolutionX int
	MaxResolutionY int
	JPEGQuality   int
}

// DimensionType indicates how dimension values are sorted.
type DimensionType string

const (
	DimensionTypeInt    DimensionType = "int"
	DimensionTypeString DimensionType = "string"
)
