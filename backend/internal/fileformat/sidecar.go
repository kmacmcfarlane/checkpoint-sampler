package fileformat

// SidecarMetadata is the external file format for JSON sidecar files written
// alongside generated images. This type carries JSON struct tags and is the
// authoritative shape for .json sidecar files on disk.
//
// Sidecar files are named after the image with a .json extension and written
// atomically (temp file + rename). They provide flat key-value generation
// metadata that is easy to parse by external tools and decouples metadata
// storage from PNG-embedded chunks.
type SidecarMetadata struct {
	Checkpoint     string  `json:"checkpoint"`
	PromptName     string  `json:"prompt_name"`
	PromptText     string  `json:"prompt_text"`
	Seed           int64   `json:"seed"`
	CFG            float64 `json:"cfg"`
	Steps          int     `json:"steps"`
	SamplerName    string  `json:"sampler_name"`
	Scheduler      string  `json:"scheduler"`
	Width          int     `json:"width"`
	Height         int     `json:"height"`
	NegativePrompt string  `json:"negative_prompt"`
	VAE            string  `json:"vae"`
	CLIP           string  `json:"clip"`
	Shift          *float64 `json:"shift,omitempty"`
	WorkflowName   string  `json:"workflow_name"`
	JobID          string  `json:"job_id"`
	Timestamp      string  `json:"timestamp"` // RFC3339 UTC
}
