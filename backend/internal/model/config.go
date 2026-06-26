package model

// Config represents the application configuration.
type Config struct {
	CheckpointDirs   []string
	LoraDirs         []string // directories to scan for LoRA .safetensors files (optional)
	BaseModelDir     string   // directory for base model browsing (optional, falls back to checkpoint_dirs[0])
	SampleDir        string
	Port             int
	IPAddress        string
	DBPath           string
	ComfyUI          *ComfyUIConfig
	Thumbnails       *ThumbnailConfig
	WsPingInterval   int // seconds between WebSocket ping frames; 0 disables pings
	MaxRequestSizeMB int // maximum allowed HTTP request body size in megabytes; default 200
	MaxStudyItems    int // maximum total work items allowed per study/job; default 50000
}

// ComfyUIConfig represents the ComfyUI integration configuration.
// This section is optional; if absent, ComfyUI features are disabled.
type ComfyUIConfig struct {
	URL                string
	WorkflowDir        string
	ReconnectInterval  int // seconds between WebSocket reconnect attempts; default 10
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
