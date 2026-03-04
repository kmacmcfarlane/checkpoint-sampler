package model_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

var _ = Describe("Study.OutputDirName", func() {
	type testCase struct {
		name     string
		version  int
		expected string
	}

	DescribeTable("returns versioned output directory name",
		func(tc testCase) {
			s := model.Study{Name: tc.name, Version: tc.version}
			Expect(s.OutputDirName()).To(Equal(tc.expected))
		},
		Entry("version 1",
			testCase{name: "My Study", version: 1, expected: "My Study/v1"}),
		Entry("version 2",
			testCase{name: "My Study", version: 2, expected: "My Study/v2"}),
		Entry("version 10",
			testCase{name: "Test", version: 10, expected: "Test/v10"}),
		Entry("study name with spaces",
			testCase{name: "Photo Study v2", version: 3, expected: "Photo Study v2/v3"}),
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
