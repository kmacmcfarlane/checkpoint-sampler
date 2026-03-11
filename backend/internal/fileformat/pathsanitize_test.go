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
