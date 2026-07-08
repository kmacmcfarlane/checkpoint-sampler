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

// LoraStrengthPair represents a pair of LoRA strength values for model and CLIP.
type LoraStrengthPair struct {
	StrengthModel float64
	StrengthClip  float64
}

// ResolutionPair represents a single image resolution as a width/height pair.
type ResolutionPair struct {
	Width  int
	Height int
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
	// Width/Height are the representative (first) resolution, kept for backward
	// compatibility and manifest/job display. Resolutions is the authoritative
	// multi-value dimension used for cross-product expansion (S-157).
	Width  int
	Height int
	// Resolutions is the multi-value resolution dimension. Always contains at
	// least one pair for a valid study; Width/Height mirror Resolutions[0].
	Resolutions      []ResolutionPair
	WorkflowTemplate string // ComfyUI workflow template filename (optional)
	// VAE/TextEncoder/Shift are the representative (first) values, kept for
	// backward compatibility and job/manifest display. The plural list fields
	// below are the authoritative multi-value dimensions (S-157). A dimension is
	// only meaningful when the selected workflow declares the matching cs_role.
	VAE               string   // ComfyUI VAE model path (optional; mirrors VAEs[0])
	TextEncoder       string   // ComfyUI CLIP/text encoder model path (optional; mirrors TextEncoders[0])
	Shift             *float64 // AuraFlow shift value (optional, nullable; mirrors Shifts[0])
	VAEs              []string // multi-value VAE dimension (may be empty)
	TextEncoders      []string // multi-value text-encoder dimension (may be empty)
	Shifts            []float64 // multi-value shift dimension (may be empty)
	LoraStrengthPairs []LoraStrengthPair
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// NamedPrompt represents a prompt with a name and text.
type NamedPrompt struct {
	Name string
	Text string
}

// ImagesPerCheckpoint calculates the total number of images that will be generated
// per checkpoint using this study for non-LoRA (checkpoint) training runs.
// For LoRA runs, use ImagesPerCheckpointLoRA() which includes strength pair expansion.
func (s Study) ImagesPerCheckpoint() int {
	base := len(s.Prompts) * len(s.Steps) * len(s.CFGs) * len(s.SamplerSchedulerPairs) * len(s.Seeds)
	// S-157: multiply by each new multi-value dimension. An empty list means the
	// dimension is not being swept (single implicit value), so it contributes a
	// factor of 1 and never zeroes out the product.
	base *= DimMultiplier(len(s.Resolutions))
	base *= DimMultiplier(len(s.VAEs))
	base *= DimMultiplier(len(s.TextEncoders))
	base *= DimMultiplier(len(s.Shifts))
	return base
}

// DimMultiplier returns the cross-product contribution of a dimension with the
// given number of values: n when non-empty, or 1 when empty (a single implicit
// value with no substitution). Exported so other layers (e.g. the study
// service's cap validation) can reuse the exact same semantics instead of
// duplicating this helper.
func DimMultiplier(n int) int {
	if n <= 0 {
		return 1
	}
	return n
}

// ImagesPerCheckpointLoRA calculates the total number of images per checkpoint
// for LoRA training runs, including the LoRA strength pairs dimension.
func (s Study) ImagesPerCheckpointLoRA() int {
	base := s.ImagesPerCheckpoint()
	if len(s.LoraStrengthPairs) > 0 {
		return base * len(s.LoraStrengthPairs)
	}
	return base
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
