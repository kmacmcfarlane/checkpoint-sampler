package service_test

import (
	"errors"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeBaseModelFS implements service.BaseModelFileSystem for testing.
type fakeBaseModelFS struct {
	files map[string][]string
	err   error
}

func (f *fakeBaseModelFS) ListSafetensorsFiles(root string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.files[root], nil
}

var _ = Describe("BaseModelService", func() {
	var logger *logrus.Logger

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetLevel(logrus.FatalLevel)
	})

	DescribeTable("resolves directory correctly",
		func(baseModelDir string, checkpointDirs []string, expectedDir string, files map[string][]string, expected []string) {
			fs := &fakeBaseModelFS{files: files}
			svc := service.NewBaseModelService(fs, baseModelDir, checkpointDirs, logger)
			result, err := svc.ListBaseModels()
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(Equal(expected))
		},
		Entry("uses base_model_dir when configured",
			"/models",
			[]string{"/checkpoints"},
			"/models",
			map[string][]string{"/models": {"flux1-dev.safetensors", "sdxl-base.safetensors"}},
			[]string{"flux1-dev.safetensors", "sdxl-base.safetensors"},
		),
		Entry("falls back to checkpoint_dirs[0] when base_model_dir is empty",
			"",
			[]string{"/checkpoints"},
			"/checkpoints",
			map[string][]string{"/checkpoints": {"model-a.safetensors", "model-b.safetensors"}},
			[]string{"model-a.safetensors", "model-b.safetensors"},
		),
		Entry("returns empty list when no directories configured",
			"",
			[]string{},
			"",
			map[string][]string{},
			[]string{},
		),
	)

	It("returns sorted results", func() {
		fs := &fakeBaseModelFS{
			files: map[string][]string{
				"/models": {"z-model.safetensors", "a-model.safetensors", "m-model.safetensors"},
			},
		}
		svc := service.NewBaseModelService(fs, "/models", nil, logger)
		result, err := svc.ListBaseModels()
		Expect(err).NotTo(HaveOccurred())
		Expect(result).To(Equal([]string{"a-model.safetensors", "m-model.safetensors", "z-model.safetensors"}))
	})

	It("returns empty list when directory has no .safetensors files", func() {
		fs := &fakeBaseModelFS{
			files: map[string][]string{"/models": {}},
		}
		svc := service.NewBaseModelService(fs, "/models", nil, logger)
		result, err := svc.ListBaseModels()
		Expect(err).NotTo(HaveOccurred())
		Expect(result).To(BeEmpty())
	})

	It("propagates filesystem errors", func() {
		fs := &fakeBaseModelFS{
			err: errors.New("permission denied"),
		}
		svc := service.NewBaseModelService(fs, "/models", nil, logger)
		_, err := svc.ListBaseModels()
		Expect(err).To(MatchError("permission denied"))
	})

	It("includes subdirectory paths", func() {
		fs := &fakeBaseModelFS{
			files: map[string][]string{
				"/models": {"subdir/nested-model.safetensors", "top-level.safetensors"},
			},
		}
		svc := service.NewBaseModelService(fs, "/models", nil, logger)
		result, err := svc.ListBaseModels()
		Expect(err).NotTo(HaveOccurred())
		Expect(result).To(Equal([]string{"subdir/nested-model.safetensors", "top-level.safetensors"}))
	})
})
