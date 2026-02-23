package model

import "time"

// SamplePreset represents a saved set of sampling parameters for image generation.
type SamplePreset struct {
	ID             string
	Name           string
	Prompts        []NamedPrompt
	NegativePrompt string
	Steps          []int
	CFGs           []float64
	Samplers       []string
	Schedulers     []string
	Seeds          []int64
	Width          int
	Height         int
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// NamedPrompt represents a prompt with a name and text.
type NamedPrompt struct {
	Name string
	Text string
}

// ImagesPerCheckpoint calculates the total number of images that will be generated
// per checkpoint using this preset.
func (sp SamplePreset) ImagesPerCheckpoint() int {
	return len(sp.Prompts) * len(sp.Steps) * len(sp.CFGs) * len(sp.Samplers) * len(sp.Schedulers) * len(sp.Seeds)
}
