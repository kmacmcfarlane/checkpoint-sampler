package fileformat_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
)

var _ = Describe("SanitizeTrainingRunName", func() {
	DescribeTable("replaces slashes with underscores",
		func(input, expected string) {
			Expect(fileformat.SanitizeTrainingRunName(input)).To(Equal(expected))
		},

		// Forward slash cases
		Entry("single-level forward slash prefix",
			"qwen/Qwen2-VL", "qwen_Qwen2-VL"),
		Entry("multi-level forward slashes",
			"my/nested/run", "my_nested_run"),
		Entry("leading forward slash",
			"/leading", "_leading"),
		Entry("trailing forward slash",
			"trailing/", "trailing_"),

		// Backward slash cases
		Entry("single backward slash",
			`windows\style`, "windows_style"),
		Entry("multi-level backward slashes",
			`a\b\c`, "a_b_c"),

		// Mixed cases
		Entry("mixed forward and backward slashes",
			`mixed/and\slashes`, "mixed_and_slashes"),

		// No-op cases
		Entry("plain name without slashes is unchanged",
			"simple-model", "simple-model"),
		Entry("name with hyphens and dots is unchanged",
			"my-model-v1.2.3", "my-model-v1.2.3"),
		Entry("empty string returns empty string",
			"", ""),
	)
})

// B-162: single shared helper for the study output directory, used by the
// image-write path, completeness check, and manifest write in the job
// executor so they cannot diverge on whether the base_model level is present.
var _ = Describe("StudyOutputDir", func() {
	DescribeTable("computes the study output directory",
		func(trainingRunName, studyName, baseModel, expected string) {
			Expect(fileformat.StudyOutputDir(trainingRunName, studyName, baseModel)).To(Equal(expected))
		},

		// Non-LoRA (BaseModel empty): unchanged naive path, no trailing slash
		// or empty path segment.
		Entry("no base model returns naive run/study path",
			"my-model", "My Study", "", "my-model/My Study"),

		// LoRA (BaseModel set): base_model level appended.
		Entry("base model with extension appends basename without extension",
			"my-model", "My Study", "loras/my_lora_v1.safetensors", "my-model/My Study/my_lora_v1"),
		Entry("base model without extension produces the same directory name",
			"my-model", "My Study", "loras/my_lora_v1", "my-model/My Study/my_lora_v1"),
		Entry("absolute base model path uses only the basename",
			"my-model", "My Study", "/data/loras/my_lora_v1.safetensors", "my-model/My Study/my_lora_v1"),

		// Training run names with slashes must be sanitized exactly once,
		// regardless of whether a base_model level is present.
		Entry("training run name with slashes is sanitized once (non-LoRA)",
			"qwen/training/bidi-v0.3", "My Study", "", "qwen_training_bidi-v0.3/My Study"),
		Entry("training run name with slashes is sanitized once (LoRA)",
			"qwen/training/bidi-v0.3", "My Study", "loras/qwen_bidi_v0.3.safetensors",
			"qwen_training_bidi-v0.3/My Study/qwen_bidi_v0.3"),
	)
})
