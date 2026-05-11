package service_test

import (
	"errors"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

var _ = Describe("LoraPathMatcher", func() {
	var (
		provider *fakeComfyUIModelsProvider
		matcher  *service.LoraPathMatcher
		logger   *logrus.Logger
	)

	BeforeEach(func() {
		provider = newFakeComfyUIModelsProvider()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		matcher = service.NewLoraPathMatcher(provider, logger)
	})

	Describe("MatchCheckpointPath", func() {
		It("matches exact filename from LoRA model list", func() {
			provider.models[service.ComfyUIModelTypeLoRA] = []string{
				"lora1.safetensors",
				"lora2.safetensors",
			}

			path, err := matcher.MatchCheckpointPath("lora1.safetensors")
			Expect(err).NotTo(HaveOccurred())
			Expect(path).To(Equal("lora1.safetensors"))
		})

		It("matches filename with directory prefix", func() {
			provider.models[service.ComfyUIModelTypeLoRA] = []string{
				"loras/subdir/my-lora.safetensors",
				"other/lora.safetensors",
			}

			path, err := matcher.MatchCheckpointPath("my-lora.safetensors")
			Expect(err).NotTo(HaveOccurred())
			Expect(path).To(Equal("loras/subdir/my-lora.safetensors"))
		})

		It("returns error when no match found", func() {
			provider.models[service.ComfyUIModelTypeLoRA] = []string{
				"lora1.safetensors",
			}

			_, err := matcher.MatchCheckpointPath("nonexistent.safetensors")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found in ComfyUI LoRA models"))
		})

		It("returns error when ComfyUI query fails", func() {
			provider.getModelsErr = errors.New("connection failed")

			_, err := matcher.MatchCheckpointPath("lora1.safetensors")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("querying ComfyUI LoRA models"))
		})

		It("handles empty model list", func() {
			provider.models[service.ComfyUIModelTypeLoRA] = []string{}

			_, err := matcher.MatchCheckpointPath("lora1.safetensors")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found in ComfyUI LoRA models"))
		})
	})
})
