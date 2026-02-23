package service_test

import (
	"fmt"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeScannerFS implements service.ScannerFileSystem for testing.
type fakeScannerFS struct {
	files map[string][]string // abs dir → list of filenames
	errs  map[string]error    // abs dir → error to return
}

func newFakeScannerFS() *fakeScannerFS {
	return &fakeScannerFS{
		files: make(map[string][]string),
		errs:  make(map[string]error),
	}
}

func (f *fakeScannerFS) ListPNGFiles(dir string) ([]string, error) {
	if err, ok := f.errs[dir]; ok {
		return nil, err
	}
	return f.files[dir], nil
}

var _ = Describe("Scanner", func() {
	var (
		fs        *fakeScannerFS
		scanner   *service.Scanner
		sampleDir string
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		fs = newFakeScannerFS()
		scanner = service.NewScanner(fs, sampleDir)
	})

	Describe("ScanTrainingRun", func() {
		Context("with checkpoints that have samples", func() {
			It("parses query-encoded filenames and adds checkpoint dimension", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].RelativePath).To(Equal("model-step00001000.safetensors/index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("index", "5"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("prompt_name", "portal_hub"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("seed", "422"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("cfg", "3"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("checkpoint", "1000"))
			})

			It("discovers checkpoint dimension from multiple checkpoints", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
						{Filename: "model-step00002000.safetensors", StepNumber: 2000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=1&cfg=3&_00001_.png",
				}
				fs.files["/samples/model-step00002000.safetensors"] = []string{
					"seed=1&cfg=3&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(2))

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap).To(HaveKey("checkpoint"))
				Expect(dimMap["checkpoint"].Type).To(Equal(model.DimensionTypeInt))
				Expect(dimMap["checkpoint"].Values).To(Equal([]string{"1000", "2000"}))
			})
		})

		Context("skipping checkpoints without samples", func() {
			It("only scans checkpoints with HasSamples=true", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
						{Filename: "model-step00002000.safetensors", StepNumber: 2000, HasSamples: false},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=1&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}
				Expect(dimMap["checkpoint"].Values).To(Equal([]string{"1000"}))
			})
		})

		Context("empty results", func() {
			It("returns empty results when no checkpoints have samples", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model.safetensors", StepNumber: -1, HasSamples: false},
					},
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(BeEmpty())
				Expect(result.Dimensions).To(BeEmpty())
			})
		})

		Context("batch deduplication", func() {
			It("uses the highest batch number when duplicates exist", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=1&cfg=3&_00001_.png",
					"seed=1&cfg=3&_00003_.png",
					"seed=1&cfg=3&_00002_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].RelativePath).To(Equal("model-step00001000.safetensors/seed=1&cfg=3&_00003_.png"))
			})

			It("keeps images with different dimensions even if same batch number", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=1&cfg=3&_00001_.png",
					"seed=2&cfg=3&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(2))
			})
		})

		Context("dimension type inference", func() {
			It("infers int type for numeric filename dimensions", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=42&prompt_name=test&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap["seed"].Type).To(Equal(model.DimensionTypeInt))
				Expect(dimMap["prompt_name"].Type).To(Equal(model.DimensionTypeString))
				Expect(dimMap["checkpoint"].Type).To(Equal(model.DimensionTypeInt))
			})
		})

		Context("dimension value sorting", func() {
			It("sorts int dimensions numerically", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"step=100&_00001_.png",
					"step=20&_00001_.png",
					"step=3&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap["step"].Values).To(Equal([]string{"3", "20", "100"}))
			})

			It("sorts string dimensions lexicographically", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"prompt=charlie&_00001_.png",
					"prompt=alpha&_00001_.png",
					"prompt=bravo&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap["prompt"].Values).To(Equal([]string{"alpha", "bravo", "charlie"}))
			})
		})

		Context("error handling", func() {
			It("returns error when listing PNG files fails", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.errs["/samples/model-step00001000.safetensors"] = fmt.Errorf("permission denied")

				_, err := scanner.ScanTrainingRun(tr)

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("permission denied"))
			})
		})

		Context("edge cases", func() {
			It("handles filenames without batch suffix", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=1&cfg=3.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("seed", "1"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("cfg", "3"))
			})

			It("returns deterministic ordering of images by path", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=3&_00001_.png",
					"seed=1&_00001_.png",
					"seed=2&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(3))
				Expect(result.Images[0].RelativePath).To(ContainSubstring("seed=1"))
				Expect(result.Images[1].RelativePath).To(ContainSubstring("seed=2"))
				Expect(result.Images[2].RelativePath).To(ContainSubstring("seed=3"))
			})

			It("returns deterministic ordering of dimensions by name", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"zebra=1&alpha=2&middle=3&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				// checkpoint + alpha + middle + zebra = 4 dimensions
				Expect(result.Dimensions).To(HaveLen(4))
				Expect(result.Dimensions[0].Name).To(Equal("alpha"))
				Expect(result.Dimensions[1].Name).To(Equal("checkpoint"))
				Expect(result.Dimensions[2].Name).To(Equal("middle"))
				Expect(result.Dimensions[3].Name).To(Equal("zebra"))
			})

			It("relative path format is checkpoint_filename/image_filename", func() {
				tr := model.TrainingRun{
					Name: "model",
					Checkpoints: []model.Checkpoint{
						{Filename: "model-step00001000.safetensors", StepNumber: 1000, HasSamples: true},
					},
				}
				fs.files["/samples/model-step00001000.safetensors"] = []string{
					"seed=1&_00001_.png",
				}

				result, err := scanner.ScanTrainingRun(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images[0].RelativePath).To(Equal("model-step00001000.safetensors/seed=1&_00001_.png"))
			})
		})
	})
})
