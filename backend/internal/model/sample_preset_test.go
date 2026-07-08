package model_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

var _ = Describe("Study.OutputDirName", func() {
	type testCase struct {
		name     string
		expected string
	}

	DescribeTable("returns output directory name (study name)",
		func(tc testCase) {
			s := model.Study{Name: tc.name}
			Expect(s.OutputDirName()).To(Equal(tc.expected))
		},
		Entry("simple name",
			testCase{name: "My Study", expected: "My Study"}),
		Entry("name with spaces",
			testCase{name: "Photo Study v2", expected: "Photo Study v2"}),
		Entry("single word",
			testCase{name: "Test", expected: "Test"}),
	)
})

var _ = Describe("JoinPromptPrefix", func() {
	// AC: Unit tests for prefix joining logic (empty prefix, prefix with trailing
	// period+space, prefix with trailing comma+space, prefix without trailing delimiter)
	type testCase struct {
		prefix     string
		promptText string
		expected   string
	}

	DescribeTable("prepends prefix to prompt text with smart separator",
		func(tc testCase) {
			result := model.JoinPromptPrefix(tc.prefix, tc.promptText)
			Expect(result).To(Equal(tc.expected))
		},
		// AC: empty prefix means no prepending
		Entry("empty prefix returns prompt text unchanged",
			testCase{
				prefix:     "",
				promptText: "a mystical forest",
				expected:   "a mystical forest",
			}),
		// AC: prefix ending with '. ' concatenates directly
		Entry("prefix ending with period+space concatenates directly",
			testCase{
				prefix:     "photo of a person. ",
				promptText: "walking in a forest",
				expected:   "photo of a person. walking in a forest",
			}),
		// AC: prefix ending with ', ' concatenates directly
		Entry("prefix ending with comma+space concatenates directly",
			testCase{
				prefix:     "photo of a person, ",
				promptText: "walking in a forest",
				expected:   "photo of a person, walking in a forest",
			}),
		// AC: prefix without trailing delimiter appends '. ' between prefix and prompt text
		Entry("prefix without trailing delimiter appends period+space separator",
			testCase{
				prefix:     "photo of a person",
				promptText: "walking in a forest",
				expected:   "photo of a person. walking in a forest",
			}),
		// Edge case: prefix ending with just a period (no space)
		Entry("prefix ending with just a period gets separator appended",
			testCase{
				prefix:     "photo of a person.",
				promptText: "walking in a forest",
				expected:   "photo of a person.. walking in a forest",
			}),
		// Edge case: prefix ending with just a comma (no space)
		Entry("prefix ending with just a comma gets separator appended",
			testCase{
				prefix:     "photo of a person,",
				promptText: "walking in a forest",
				expected:   "photo of a person,. walking in a forest",
			}),
		// Edge case: empty prompt text with non-empty prefix
		Entry("non-empty prefix with empty prompt text",
			testCase{
				prefix:     "photo of a person",
				promptText: "",
				expected:   "photo of a person. ",
			}),
		// Edge case: both empty
		Entry("both empty returns empty string",
			testCase{
				prefix:     "",
				promptText: "",
				expected:   "",
			}),
	)
})

var _ = Describe("Study.ImagesPerCheckpoint (S-157 multi-value dimensions)", func() {
	baseStudy := func() model.Study {
		return model.Study{
			Prompts:               []model.NamedPrompt{{Name: "p", Text: "t"}},
			Steps:                 []int{4},
			CFGs:                  []float64{1.0},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
			Seeds:                 []int64{1},
		}
	}

	It("treats empty resolution/vae/text-encoder/shift dimensions as a factor of 1", func() {
		s := baseStudy()
		Expect(s.ImagesPerCheckpoint()).To(Equal(1))
	})

	It("behaves identically when each new dimension has exactly one value", func() {
		s := baseStudy()
		s.Resolutions = []model.ResolutionPair{{Width: 1024, Height: 1024}}
		s.VAEs = []string{"ae.safetensors"}
		s.TextEncoders = []string{"clip_l.safetensors"}
		s.Shifts = []float64{3.0}
		Expect(s.ImagesPerCheckpoint()).To(Equal(1))
	})

	It("multiplies the product by each non-empty new dimension", func() {
		s := baseStudy()
		s.Resolutions = []model.ResolutionPair{{Width: 1024, Height: 1024}, {Width: 768, Height: 768}} // ×2
		s.VAEs = []string{"a", "b", "c"}                                                                // ×3
		s.TextEncoders = []string{"x", "y"}                                                             // ×2
		s.Shifts = []float64{1.0, 2.0}                                                                  // ×2
		// 1 prompt × 1 step × 1 cfg × 1 pair × 1 seed × 2 × 3 × 2 × 2 = 24
		Expect(s.ImagesPerCheckpoint()).To(Equal(24))
	})

	It("does not multiply for an empty dimension a workflow does not declare", func() {
		s := baseStudy()
		s.Resolutions = []model.ResolutionPair{{Width: 512, Height: 512}}
		s.Shifts = nil // shift role not present → empty → factor 1
		Expect(s.ImagesPerCheckpoint()).To(Equal(1))
	})
})
