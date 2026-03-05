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

// Study represents a saved set of sampling parameters for image generation.
// A study defines a set of generation parameters and outputs into its own
// subdirectory under the sample directory, enabling multiple studies per
// training run with different parameter sets.
//
// Studies are immutable once they have generated samples. If a user wants to
// change the configuration of a study that has samples, they must either fork
// it (creating a new study with modified settings) or regenerate all samples
// with the new settings.
type Study struct {
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
// per checkpoint using this study.
func (s Study) ImagesPerCheckpoint() int {
	return len(s.Prompts) * len(s.Steps) * len(s.CFGs) * len(s.SamplerSchedulerPairs) * len(s.Seeds)
}

// OutputDirName returns the output directory name for this study.
// The format is simply the study name, e.g. "My Study".
func (s Study) OutputDirName() string {
	return s.Name
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
