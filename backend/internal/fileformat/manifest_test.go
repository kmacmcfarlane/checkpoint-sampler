package fileformat_test

import (
	"encoding/json"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

var _ = Describe("JobManifest", func() {
	var (
		job         model.SampleJob
		study       model.Study
		checkpoints []string
		shift       float64
	)

	BeforeEach(func() {
		shift = 3.5
		job = model.SampleJob{
			ID:              "job-001",
			TrainingRunName: "my-model",
			StudyID:         "study-001",
			StudyName:       "Test Study",
			WorkflowName:    "flux_dev.json",
			VAE:             "ae.safetensors",
			CLIP:            "clip_l.safetensors",
			Shift:           &shift,
		}
		study = model.Study{
			ID:             "study-001",
			Name:           "Test Study",
			Version:        2,
			PromptPrefix:   "high quality",
			Prompts: []model.NamedPrompt{
				{Name: "forest", Text: "a dense forest"},
				{Name: "ocean", Text: "ocean at sunset"},
			},
			NegativePrompt: "blurry, artifacts",
			Steps:          []int{20, 30},
			CFGs:           []float64{7.0, 9.5},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{
				{Sampler: "euler", Scheduler: "normal"},
			},
			Seeds:  []int64{42, 99},
			Width:  1024,
			Height: 768,
		}
		checkpoints = []string{
			"model-step00001000.safetensors",
			"model-step00002000.safetensors",
		}
	})

	// AC1: Each generation job outputs a JSON manifest file containing all job params
	Describe("NewJobManifest", func() {
		It("creates a manifest with all job metadata", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)

			Expect(m.JobID).To(Equal("job-001"))
			Expect(m.TrainingRunName).To(Equal("my-model"))
			Expect(m.WorkflowName).To(Equal("flux_dev.json"))
			Expect(m.VAE).To(Equal("ae.safetensors"))
			Expect(m.CLIP).To(Equal("clip_l.safetensors"))
			Expect(m.Shift).To(Equal(&shift))
			Expect(m.Timestamp).NotTo(BeEmpty())
		})

		// AC2: Manifest includes study config, version, training run, checkpoint list, and all dimension values
		It("creates a manifest with study config snapshot", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)

			Expect(m.StudyID).To(Equal("study-001"))
			Expect(m.StudyName).To(Equal("Test Study"))
			Expect(m.StudyVersion).To(Equal(2))
			Expect(m.PromptPrefix).To(Equal("high quality"))
			Expect(m.NegativePrompt).To(Equal("blurry, artifacts"))
			Expect(m.Width).To(Equal(1024))
			Expect(m.Height).To(Equal(768))
		})

		It("maps prompts to manifest format", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)

			Expect(m.Prompts).To(HaveLen(2))
			Expect(m.Prompts[0].Name).To(Equal("forest"))
			Expect(m.Prompts[0].Text).To(Equal("a dense forest"))
			Expect(m.Prompts[1].Name).To(Equal("ocean"))
			Expect(m.Prompts[1].Text).To(Equal("ocean at sunset"))
		})

		It("maps dimension values", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)

			Expect(m.Steps).To(Equal([]int{20, 30}))
			Expect(m.CFGs).To(Equal([]float64{7.0, 9.5}))
			Expect(m.SamplerSchedulerPairs).To(HaveLen(1))
			Expect(m.SamplerSchedulerPairs[0].Sampler).To(Equal("euler"))
			Expect(m.SamplerSchedulerPairs[0].Scheduler).To(Equal("normal"))
			Expect(m.Seeds).To(Equal([]int64{42, 99}))
		})

		// AC2: checkpoint list
		It("includes checkpoint list", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)

			Expect(m.Checkpoints).To(Equal([]string{
				"model-step00001000.safetensors",
				"model-step00002000.safetensors",
			}))
		})

		It("calculates images per checkpoint from study", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)

			// 2 prompts * 2 steps * 2 cfgs * 1 pair * 2 seeds = 16
			Expect(m.ImagesPerCheckpoint).To(Equal(16))
		})

		It("omits shift when nil", func() {
			job.Shift = nil
			m := fileformat.NewJobManifest(job, study, checkpoints)
			Expect(m.Shift).To(BeNil())
		})
	})

	// AC5: Unit tests for manifest write, read (marshal/unmarshal round-trip)
	Describe("MarshalManifest / UnmarshalManifest", func() {
		It("round-trips a manifest through marshal and unmarshal", func() {
			original := fileformat.NewJobManifest(job, study, checkpoints)

			data, err := fileformat.MarshalManifest(original)
			Expect(err).NotTo(HaveOccurred())
			Expect(data).NotTo(BeEmpty())

			restored, err := fileformat.UnmarshalManifest(data)
			Expect(err).NotTo(HaveOccurred())

			// Compare all fields
			Expect(restored.JobID).To(Equal(original.JobID))
			Expect(restored.TrainingRunName).To(Equal(original.TrainingRunName))
			Expect(restored.WorkflowName).To(Equal(original.WorkflowName))
			Expect(restored.VAE).To(Equal(original.VAE))
			Expect(restored.CLIP).To(Equal(original.CLIP))
			Expect(restored.Shift).To(Equal(original.Shift))
			Expect(restored.Timestamp).To(Equal(original.Timestamp))

			Expect(restored.StudyID).To(Equal(original.StudyID))
			Expect(restored.StudyName).To(Equal(original.StudyName))
			Expect(restored.StudyVersion).To(Equal(original.StudyVersion))
			Expect(restored.PromptPrefix).To(Equal(original.PromptPrefix))
			Expect(restored.Prompts).To(Equal(original.Prompts))
			Expect(restored.NegativePrompt).To(Equal(original.NegativePrompt))
			Expect(restored.Steps).To(Equal(original.Steps))
			Expect(restored.CFGs).To(Equal(original.CFGs))
			Expect(restored.SamplerSchedulerPairs).To(Equal(original.SamplerSchedulerPairs))
			Expect(restored.Seeds).To(Equal(original.Seeds))
			Expect(restored.Width).To(Equal(original.Width))
			Expect(restored.Height).To(Equal(original.Height))

			Expect(restored.Checkpoints).To(Equal(original.Checkpoints))
			Expect(restored.ImagesPerCheckpoint).To(Equal(original.ImagesPerCheckpoint))
		})

		It("produces pretty-printed JSON", func() {
			m := fileformat.NewJobManifest(job, study, checkpoints)
			data, err := fileformat.MarshalManifest(m)
			Expect(err).NotTo(HaveOccurred())

			// Pretty-printed JSON has newlines and indentation
			Expect(string(data)).To(ContainSubstring("\n"))
			Expect(string(data)).To(ContainSubstring("  "))
		})

		It("omits shift when nil in serialized JSON", func() {
			job.Shift = nil
			m := fileformat.NewJobManifest(job, study, checkpoints)
			data, err := fileformat.MarshalManifest(m)
			Expect(err).NotTo(HaveOccurred())

			var raw map[string]interface{}
			Expect(json.Unmarshal(data, &raw)).To(Succeed())
			Expect(raw).NotTo(HaveKey("shift"))
		})

		It("omits empty optional string fields", func() {
			job.VAE = ""
			job.CLIP = ""
			study.PromptPrefix = ""
			study.NegativePrompt = ""
			m := fileformat.NewJobManifest(job, study, checkpoints)
			data, err := fileformat.MarshalManifest(m)
			Expect(err).NotTo(HaveOccurred())

			var raw map[string]interface{}
			Expect(json.Unmarshal(data, &raw)).To(Succeed())
			Expect(raw).NotTo(HaveKey("vae"))
			Expect(raw).NotTo(HaveKey("clip"))
			Expect(raw).NotTo(HaveKey("prompt_prefix"))
			Expect(raw).NotTo(HaveKey("negative_prompt"))
		})

		It("returns error for invalid JSON in UnmarshalManifest", func() {
			_, err := fileformat.UnmarshalManifest([]byte("not-json"))
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("unmarshaling manifest"))
		})
	})
})
