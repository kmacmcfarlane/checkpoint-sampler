package model_test

import (
	"errors"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// baseStudy returns a Study whose non-LoRA cross-product is exactly 1 image, so
// each test can vary a single dimension and read the product directly.
func baseStudy() model.Study {
	return model.Study{
		Prompts:               []model.NamedPrompt{{Name: "p", Text: "a cat"}},
		Steps:                 []int{20},
		CFGs:                  []float64{7},
		SamplerSchedulerPairs: []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "normal"}},
		Seeds:                 []int64{1},
	}
}

var _ = Describe("Study.ImagesPerCheckpointLoRA", func() {
	// AC: model package behavior methods covered with DescribeTable tests
	type testCase struct {
		mutate   func(*model.Study)
		expected int
	}

	DescribeTable("multiplies the base cross-product by the LoRA strength pairs",
		func(tc testCase) {
			s := baseStudy()
			if tc.mutate != nil {
				tc.mutate(&s)
			}
			Expect(s.ImagesPerCheckpointLoRA()).To(Equal(tc.expected))
		},
		Entry("no strength pairs contributes a factor of 1",
			testCase{expected: 1}),
		Entry("empty (non-nil) strength pairs slice contributes a factor of 1",
			testCase{
				mutate:   func(s *model.Study) { s.LoraStrengthPairs = []model.LoraStrengthPair{} },
				expected: 1,
			}),
		Entry("one strength pair leaves the base unchanged",
			testCase{
				mutate: func(s *model.Study) {
					s.LoraStrengthPairs = []model.LoraStrengthPair{{StrengthModel: 1, StrengthClip: 1}}
				},
				expected: 1,
			}),
		Entry("three strength pairs triple the base",
			testCase{
				mutate: func(s *model.Study) {
					s.LoraStrengthPairs = []model.LoraStrengthPair{
						{StrengthModel: 0.5, StrengthClip: 0.5},
						{StrengthModel: 0.8, StrengthClip: 0.8},
						{StrengthModel: 1.0, StrengthClip: 1.0},
					}
				},
				expected: 3,
			}),
		Entry("strength pairs multiply the full cross-product",
			testCase{
				mutate: func(s *model.Study) {
					s.Steps = []int{20, 30}                 // x2
					s.Seeds = []int64{1, 2, 3}              // x3
					s.Resolutions = []model.ResolutionPair{ // x2
						{Width: 512, Height: 512},
						{Width: 768, Height: 768},
					}
					s.LoraStrengthPairs = []model.LoraStrengthPair{
						{StrengthModel: 0.5, StrengthClip: 0.5},
						{StrengthModel: 1.0, StrengthClip: 1.0},
					} // x2
				},
				expected: 2 * 3 * 2 * 2,
			}),
		Entry("a zeroed required dimension yields zero regardless of strength pairs",
			testCase{
				mutate: func(s *model.Study) {
					s.Prompts = nil
					s.LoraStrengthPairs = []model.LoraStrengthPair{
						{StrengthModel: 1, StrengthClip: 1},
						{StrengthModel: 2, StrengthClip: 2},
					}
				},
				expected: 0,
			}),
	)

	It("equals ImagesPerCheckpoint when no strength pairs are set", func() {
		s := baseStudy()
		s.Steps = []int{20, 30}
		s.VAEs = []string{"a", "b"}

		Expect(s.ImagesPerCheckpointLoRA()).To(Equal(s.ImagesPerCheckpoint()))
	})
})

var _ = Describe("TooManyItemsError", func() {
	// AC: model package behavior methods covered with DescribeTable tests
	DescribeTable("formats a stable message carrying both total and limit",
		func(total, limit int, expected string) {
			err := &model.TooManyItemsError{Total: total, Limit: limit}
			Expect(err.Error()).To(Equal(expected))
		},
		Entry("typical overflow", 60000, 50000,
			"total work items 60000 exceeds the configured maximum of 50000"),
		Entry("just over the limit", 51, 50,
			"total work items 51 exceeds the configured maximum of 50"),
		Entry("zero limit", 1, 0,
			"total work items 1 exceeds the configured maximum of 0"),
	)

	It("exposes the stable error code for transport mapping", func() {
		err := &model.TooManyItemsError{Total: 10, Limit: 5}
		Expect(err.Code()).To(Equal(model.TooManyItemsCode))
		Expect(model.TooManyItemsCode).To(Equal("too_many_items"))
	})

	It("satisfies the error interface and is matchable with errors.As", func() {
		var e error = &model.TooManyItemsError{Total: 10, Limit: 5}
		Expect(e).To(MatchError(ContainSubstring("exceeds the configured maximum")))

		var target *model.TooManyItemsError
		Expect(errors.As(e, &target)).To(BeTrue())
		Expect(target.Total).To(Equal(10))
		Expect(target.Limit).To(Equal(5))
	})
})

var _ = Describe("cs_role helpers", func() {
	It("lists every known role exactly once", func() {
		roles := model.KnownCSRoles()
		Expect(roles).To(HaveLen(10))
		Expect(roles).To(ConsistOf(
			model.CSRoleSaveImage,
			model.CSRoleUNETLoader,
			model.CSRoleCLIPLoader,
			model.CSRoleVAELoader,
			model.CSRoleSampler,
			model.CSRolePositivePrompt,
			model.CSRoleNegativePrompt,
			model.CSRoleShift,
			model.CSRoleLatentImage,
			model.CSRoleLoraLoader,
		))

		seen := map[model.CSRole]bool{}
		for _, r := range roles {
			Expect(seen[r]).To(BeFalse(), "duplicate role %q", r)
			seen[r] = true
		}
	})

	// AC: model package behavior methods covered with DescribeTable tests
	DescribeTable("IsKnownRole recognizes only the documented cs_role values",
		func(role string, expected bool) {
			Expect(model.IsKnownRole(role)).To(Equal(expected))
		},
		Entry("save_image", "save_image", true),
		Entry("unet_loader", "unet_loader", true),
		Entry("clip_loader", "clip_loader", true),
		Entry("vae_loader", "vae_loader", true),
		Entry("sampler", "sampler", true),
		Entry("positive_prompt", "positive_prompt", true),
		Entry("negative_prompt", "negative_prompt", true),
		Entry("shift", "shift", true),
		Entry("latent_image", "latent_image", true),
		Entry("lora_loader", "lora_loader", true),
		Entry("unknown role", "not_a_role", false),
		Entry("empty string", "", false),
		Entry("is case sensitive", "Save_Image", false),
		Entry("no whitespace tolerance", " sampler", false),
		Entry("no prefix matching", "sampler_extra", false),
	)

	It("keeps IsKnownRole consistent with KnownCSRoles", func() {
		for _, r := range model.KnownCSRoles() {
			Expect(model.IsKnownRole(string(r))).To(BeTrue(), "role %q should be known", r)
		}
	})
})
