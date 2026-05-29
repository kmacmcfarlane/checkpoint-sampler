package service

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("resolveBaseModelUNETName", func() {
	type matchCase struct {
		baseModel string
		unetNames []string
		expected  string
	}

	DescribeTable("resolves base model to a single ComfyUI unet_name",
		func(tc matchCase) {
			got, err := resolveBaseModelUNETName(tc.baseModel, tc.unetNames)
			Expect(err).NotTo(HaveOccurred())
			Expect(got).To(Equal(tc.expected))
		},
		// AC: trailing-path match — unet_name carries a "checkpoints/" prefix but
		// ends with the selected base_model_dir relative path.
		Entry("trailing-path match with checkpoints prefix", matchCase{
			baseModel: "qwen/qwen_image_2512_bf16.safetensors",
			unetNames: []string{
				"checkpoints/qwen/qwen_image_2512_bf16.safetensors",
				"flux/flux1-dev.safetensors",
			},
			expected: "checkpoints/qwen/qwen_image_2512_bf16.safetensors",
		}),
		// AC: trailing-path match — exact equality (no prefix).
		Entry("trailing-path exact match", matchCase{
			baseModel: "qwen/qwen_image_2512_bf16.safetensors",
			unetNames: []string{
				"qwen/qwen_image_2512_bf16.safetensors",
			},
			expected: "qwen/qwen_image_2512_bf16.safetensors",
		}),
		// AC: trailing-path is preferred over a competing basename-only match.
		Entry("prefers trailing-path over basename-only candidate", matchCase{
			baseModel: "qwen/model.safetensors",
			unetNames: []string{
				"other/model.safetensors",            // basename-only match
				"checkpoints/qwen/model.safetensors", // trailing-path match (wins)
			},
			expected: "checkpoints/qwen/model.safetensors",
		}),
		// AC: basename fallback — no trailing-path match, single basename match.
		Entry("basename fallback when no trailing-path match", matchCase{
			baseModel: "subdir/model.safetensors",
			unetNames: []string{
				"diffusion_models/relocated/model.safetensors",
			},
			expected: "diffusion_models/relocated/model.safetensors",
		}),
		// AC: bare base model name (no directory) matches by basename.
		Entry("bare basename selection", matchCase{
			baseModel: "model.safetensors",
			unetNames: []string{
				"checkpoints/nested/model.safetensors",
			},
			expected: "checkpoints/nested/model.safetensors",
		}),
		// Backslash-separated ComfyUI path normalizes to forward slashes.
		Entry("normalizes backslash separators", matchCase{
			baseModel: "qwen/model.safetensors",
			unetNames: []string{
				"checkpoints\\qwen\\model.safetensors",
			},
			expected: "checkpoints\\qwen\\model.safetensors",
		}),
	)

	// AC: returns a clear, actionable error when no unet_name match is found.
	It("returns an actionable error when no unet_name matches", func() {
		_, err := resolveBaseModelUNETName("qwen/missing.safetensors", []string{
			"flux/flux1-dev.safetensors",
			"sdxl/sd_xl_base_1.0.safetensors",
		})
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("was not found in ComfyUI's UNET"))
		Expect(err.Error()).To(ContainSubstring("diffusion_models or checkpoints folder"))
		Expect(err.Error()).To(ContainSubstring("qwen/missing.safetensors"))
	})

	// AC: returns a clear, actionable error naming the conflicting paths when the
	// base model matches 2+ unet_name entries across namespaces.
	It("returns an ambiguity error naming the conflicting trailing-path candidates", func() {
		_, err := resolveBaseModelUNETName("qwen/model.safetensors", []string{
			"checkpoints/qwen/model.safetensors",
			"diffusion_models/qwen/model.safetensors",
		})
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("matches multiple ComfyUI UNET entries"))
		Expect(err.Error()).To(ContainSubstring("checkpoints/qwen/model.safetensors"))
		Expect(err.Error()).To(ContainSubstring("diffusion_models/qwen/model.safetensors"))
		Expect(err.Error()).To(ContainSubstring("disambiguate"))
	})

	// Ambiguity at the basename-fallback stage (no trailing-path match, multiple
	// basename matches) must also error rather than guess.
	It("returns an ambiguity error for multiple basename-only matches", func() {
		_, err := resolveBaseModelUNETName("subdir/model.safetensors", []string{
			"a/model.safetensors",
			"b/model.safetensors",
		})
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("matches multiple ComfyUI UNET entries"))
		Expect(err.Error()).To(ContainSubstring("a/model.safetensors"))
		Expect(err.Error()).To(ContainSubstring("b/model.safetensors"))
	})

	It("returns an error for an empty base model", func() {
		_, err := resolveBaseModelUNETName("", []string{"qwen/model.safetensors"})
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("base model is empty"))
	})
})
