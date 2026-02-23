package service_test

import (
	"context"
	"errors"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeComfyUIModelsProvider is a test double for service.ComfyUIModelsProvider.
type fakeComfyUIModelsProvider struct {
	models      map[service.ComfyUIModelType][]string
	getModelsErr error
}

func newFakeComfyUIModelsProvider() *fakeComfyUIModelsProvider {
	return &fakeComfyUIModelsProvider{
		models: make(map[service.ComfyUIModelType][]string),
	}
}

func (f *fakeComfyUIModelsProvider) GetModels(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
	if f.getModelsErr != nil {
		return nil, f.getModelsErr
	}
	return f.models[modelType], nil
}

var _ = Describe("CheckpointPathMatcher", func() {
	var (
		provider *fakeComfyUIModelsProvider
		matcher  *service.CheckpointPathMatcher
		logger   *logrus.Logger
	)

	BeforeEach(func() {
		provider = newFakeComfyUIModelsProvider()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		matcher = service.NewCheckpointPathMatcher(provider, logger)
	})

	Describe("MatchCheckpointPath", func() {
		It("matches exact filename", func() {
			provider.models[service.ComfyUIModelTypeUNET] = []string{
				"checkpoint1.safetensors",
				"checkpoint2.safetensors",
			}

			path, err := matcher.MatchCheckpointPath("checkpoint1.safetensors")
			Expect(err).NotTo(HaveOccurred())
			Expect(path).To(Equal("checkpoint1.safetensors"))
		})

		It("matches filename with directory prefix", func() {
			provider.models[service.ComfyUIModelTypeUNET] = []string{
				"models/qwen/checkpoint1.safetensors",
				"models/flux/checkpoint2.safetensors",
			}

			path, err := matcher.MatchCheckpointPath("checkpoint1.safetensors")
			Expect(err).NotTo(HaveOccurred())
			Expect(path).To(Equal("models/qwen/checkpoint1.safetensors"))
		})

		It("matches first occurrence when multiple paths match", func() {
			provider.models[service.ComfyUIModelTypeUNET] = []string{
				"models/qwen/checkpoint1.safetensors",
				"other/checkpoint1.safetensors",
			}

			path, err := matcher.MatchCheckpointPath("checkpoint1.safetensors")
			Expect(err).NotTo(HaveOccurred())
			Expect(path).To(Equal("models/qwen/checkpoint1.safetensors"))
		})

		It("returns error when no match found", func() {
			provider.models[service.ComfyUIModelTypeUNET] = []string{
				"checkpoint1.safetensors",
				"checkpoint2.safetensors",
			}

			_, err := matcher.MatchCheckpointPath("nonexistent.safetensors")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found in ComfyUI"))
		})

		It("returns error when ComfyUI query fails", func() {
			provider.getModelsErr = errors.New("connection failed")

			_, err := matcher.MatchCheckpointPath("checkpoint1.safetensors")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("querying ComfyUI"))
		})

		It("handles empty model list", func() {
			provider.models[service.ComfyUIModelTypeUNET] = []string{}

			_, err := matcher.MatchCheckpointPath("checkpoint1.safetensors")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found in ComfyUI"))
		})
	})
})
