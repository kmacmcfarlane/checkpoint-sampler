package fileformat

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/buildinfo"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// ManifestFilename is the standard filename for a job manifest file.
const ManifestFilename = "manifest.json"

// JobManifest is the external file format for JSON manifest files written
// per generation job. This type carries JSON struct tags and is the
// authoritative shape for manifest.json files on disk.
//
// The manifest captures a complete snapshot of the study configuration and
// job parameters that produced the samples in a study version directory.
// Regeneration and validation use the manifest as the source of truth
// rather than the current (potentially modified) study config.
type JobManifest struct {
	// Job metadata
	JobID          string   `json:"job_id"`
	TrainingRunName string  `json:"training_run_name"`
	WorkflowName   string   `json:"workflow_name"`
	VAE            string   `json:"vae,omitempty"`
	CLIP           string   `json:"clip,omitempty"`
	Shift          *float64 `json:"shift,omitempty"`
	Timestamp      string   `json:"timestamp"` // RFC3339 UTC
	CommitSHA      string   `json:"commit_sha,omitempty"`

	// Study config snapshot
	StudyID       string                  `json:"study_id"`
	StudyName     string                  `json:"study_name"`
	PromptPrefix  string                  `json:"prompt_prefix,omitempty"`
	Prompts       []ManifestNamedPrompt   `json:"prompts"`
	NegativePrompt string                 `json:"negative_prompt,omitempty"`
	Steps         []int                   `json:"steps"`
	CFGs          []float64               `json:"cfgs"`
	SamplerSchedulerPairs []ManifestSamplerSchedulerPair `json:"sampler_scheduler_pairs"`
	Seeds         []int64                 `json:"seeds"`
	Width         int                     `json:"width"`
	Height        int                     `json:"height"`

	// Checkpoint list
	Checkpoints []string `json:"checkpoints"`

	// Derived counts
	ImagesPerCheckpoint int `json:"images_per_checkpoint"`
}

// ManifestNamedPrompt represents a prompt with a name and text in the manifest format.
type ManifestNamedPrompt struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// ManifestSamplerSchedulerPair represents a sampler/scheduler combination in the manifest format.
type ManifestSamplerSchedulerPair struct {
	Sampler   string `json:"sampler"`
	Scheduler string `json:"scheduler"`
}

// NewJobManifest builds a JobManifest from a sample job, study, and checkpoint list.
func NewJobManifest(job model.SampleJob, study model.Study, checkpoints []string) JobManifest {
	prompts := make([]ManifestNamedPrompt, len(study.Prompts))
	for i, p := range study.Prompts {
		prompts[i] = ManifestNamedPrompt{
			Name: p.Name,
			Text: p.Text,
		}
	}

	pairs := make([]ManifestSamplerSchedulerPair, len(study.SamplerSchedulerPairs))
	for i, p := range study.SamplerSchedulerPairs {
		pairs[i] = ManifestSamplerSchedulerPair{
			Sampler:   p.Sampler,
			Scheduler: p.Scheduler,
		}
	}

	return JobManifest{
		JobID:           job.ID,
		TrainingRunName: job.TrainingRunName,
		WorkflowName:    job.WorkflowName,
		VAE:             job.VAE,
		CLIP:            job.CLIP,
		Shift:           job.Shift,
		Timestamp:       time.Now().UTC().Format(time.RFC3339),
		CommitSHA:       buildinfo.CommitSHA,

		StudyID:               study.ID,
		StudyName:             study.Name,
		PromptPrefix:          study.PromptPrefix,
		Prompts:               prompts,
		NegativePrompt:        study.NegativePrompt,
		Steps:                 study.Steps,
		CFGs:                  study.CFGs,
		SamplerSchedulerPairs: pairs,
		Seeds:                 study.Seeds,
		Width:                 study.Width,
		Height:                study.Height,

		Checkpoints:         checkpoints,
		ImagesPerCheckpoint: study.ImagesPerCheckpoint(),
	}
}

// MarshalManifest serializes a JobManifest to pretty-printed JSON bytes.
func MarshalManifest(m JobManifest) ([]byte, error) {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshaling manifest: %w", err)
	}
	return data, nil
}

// UnmarshalManifest deserializes JSON bytes into a JobManifest.
func UnmarshalManifest(data []byte) (JobManifest, error) {
	var m JobManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return JobManifest{}, fmt.Errorf("unmarshaling manifest: %w", err)
	}
	return m, nil
}
