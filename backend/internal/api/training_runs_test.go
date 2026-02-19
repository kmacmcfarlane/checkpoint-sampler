package api_test

import (
	"context"
	"fmt"
	"regexp"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/training_runs"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// fakeFS is a test double for service.FileSystem.
type fakeFS struct {
	dirs  map[string][]string
	files map[string][]string
	errs  map[string]error
}

func newFakeFS() *fakeFS {
	return &fakeFS{
		dirs:  make(map[string][]string),
		files: make(map[string][]string),
		errs:  make(map[string]error),
	}
}

func (f *fakeFS) ListDirectories(root string, pattern *regexp.Regexp) ([]string, error) {
	allDirs := f.dirs[root]
	var matched []string
	for _, d := range allDirs {
		if pattern.MatchString(d) {
			matched = append(matched, d)
		}
	}
	return matched, nil
}

func (f *fakeFS) ListPNGFiles(dir string) ([]string, error) {
	if err, ok := f.errs[dir]; ok {
		return nil, err
	}
	return f.files[dir], nil
}

var _ = Describe("TrainingRunsService", func() {
	var (
		fs      *fakeFS
		scanner *service.Scanner
		root    string
	)

	BeforeEach(func() {
		root = "/data/dataset"
		fs = newFakeFS()
		scanner = service.NewScanner(fs, root)
	})

	Describe("List", func() {
		It("returns empty slice when no training runs configured", func() {
			svc := api.NewTrainingRunsService(nil, scanner)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns all configured training runs with correct IDs", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "run-alpha",
					Pattern: regexp.MustCompile(`^alpha/.+`),
				},
				{
					Name:    "run-beta",
					Pattern: regexp.MustCompile(`^beta/.+`),
				},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			Expect(result[0].ID).To(Equal(0))
			Expect(result[0].Name).To(Equal("run-alpha"))
			Expect(result[0].Pattern).To(Equal(`^alpha/.+`))
			Expect(result[1].ID).To(Equal(1))
			Expect(result[1].Name).To(Equal("run-beta"))
			Expect(result[1].Pattern).To(Equal(`^beta/.+`))
		})

		It("includes dimension configs in the response", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "with-dims",
					Pattern: regexp.MustCompile(`^test`),
					Dimensions: []model.DimensionConfig{
						{
							Name:    "step",
							Type:    model.DimensionTypeInt,
							Pattern: regexp.MustCompile(`-steps-(\d+)-`),
						},
						{
							Name:    "checkpoint",
							Type:    model.DimensionTypeString,
							Pattern: regexp.MustCompile(`([^/]+)$`),
						},
					},
				},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Dimensions).To(HaveLen(2))

			Expect(result[0].Dimensions[0].Name).To(Equal("step"))
			Expect(result[0].Dimensions[0].Type).To(Equal("int"))
			Expect(result[0].Dimensions[0].Pattern).To(Equal(`-steps-(\d+)-`))

			Expect(result[0].Dimensions[1].Name).To(Equal("checkpoint"))
			Expect(result[0].Dimensions[1].Type).To(Equal("string"))
			Expect(result[0].Dimensions[1].Pattern).To(Equal(`([^/]+)$`))
		})

		It("returns empty dimensions slice when training run has no dimensions", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:       "no-dims",
					Pattern:    regexp.MustCompile(`^test`),
					Dimensions: nil,
				},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result[0].Dimensions).To(HaveLen(0))
		})
	})

	Describe("Scan", func() {
		It("returns not_found for invalid training run ID", func() {
			runs := []model.TrainingRunConfig{
				{Name: "test", Pattern: regexp.MustCompile(`^test`)},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 5})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns not_found for negative ID", func() {
			runs := []model.TrainingRunConfig{
				{Name: "test", Pattern: regexp.MustCompile(`^test`)},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: -1})

			Expect(err).To(HaveOccurred())
		})

		It("returns scan results with images and dimensions", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			fs.dirs[root] = []string{"test/run1"}
			fs.files["/data/dataset/test/run1"] = []string{
				"seed=1&cfg=3&_00001_.png",
				"seed=2&cfg=7&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(2))
			Expect(result.Dimensions).NotTo(BeEmpty())
		})

		It("returns scan_failed when scanner encounters an error", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			fs.dirs[root] = []string{"test/run1"}
			fs.errs["/data/dataset/test/run1"] = fmt.Errorf("disk error")

			_, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("disk error"))
		})

		It("maps model types to API response types correctly", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
					Dimensions: []model.DimensionConfig{
						{
							Name:    "step",
							Type:    model.DimensionTypeInt,
							Pattern: regexp.MustCompile(`steps-(\d+)`),
						},
					},
				},
			}
			svc := api.NewTrainingRunsService(runs, scanner)

			fs.dirs[root] = []string{"test/steps-500"}
			fs.files["/data/dataset/test/steps-500"] = []string{
				"seed=42&_00001_.png",
			}

			result, err := svc.Scan(context.Background(), &gentrainingruns.ScanPayload{ID: 0})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Images).To(HaveLen(1))
			Expect(result.Images[0].RelativePath).To(Equal("test/steps-500/seed=42&_00001_.png"))
			Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("seed", "42"))
			Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("step", "500"))

			dimMap := make(map[string]*gentrainingruns.DimensionResponse)
			for _, d := range result.Dimensions {
				dimMap[d.Name] = d
			}
			Expect(dimMap["step"].Type).To(Equal("int"))
			Expect(dimMap["seed"].Type).To(Equal("int"))
		})
	})
})
