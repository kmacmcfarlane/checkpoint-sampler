package model

import (
	"strings"
	"time"
)

// SamplerSchedulerPair represents a specific sampler and scheduler combination.
type SamplerSchedulerPair struct {
	Sampler   string
	Scheduler string
}

// SamplePreset represents a saved set of sampling parameters for image generation.
type SamplePreset struct {
	ID                    string
	Name                  string
	PromptPrefix          string
	Prompts               []NamedPrompt
	NegativePrompt        string
	Steps                 []int
	CFGs                  []float64
	SamplerSchedulerPairs []SamplerSchedulerPair
	Seeds                 []int64
	Width                 int
	Height                int
	CreatedAt             time.Time
	UpdatedAt             time.Time
}

// NamedPrompt represents a prompt with a name and text.
type NamedPrompt struct {
	Name string
	Text string
}

// ImagesPerCheckpoint calculates the total number of images that will be generated
// per checkpoint using this preset.
func (sp SamplePreset) ImagesPerCheckpoint() int {
	return len(sp.Prompts) * len(sp.Steps) * len(sp.CFGs) * len(sp.SamplerSchedulerPairs) * len(sp.Seeds)
}

// JoinPromptPrefix prepends the prompt prefix to the given prompt text using
// smart separator logic. If prefix is empty, promptText is returned unchanged.
// If prefix already ends with ". " or ", ", concatenate directly; otherwise
// append ". " between the prefix and prompt text.
func JoinPromptPrefix(prefix, promptText string) string {
	if prefix == "" {
		return promptText
	}
	if strings.HasSuffix(prefix, ". ") || strings.HasSuffix(prefix, ", ") {
		return prefix + promptText
	}
	return prefix + ". " + promptText
}
