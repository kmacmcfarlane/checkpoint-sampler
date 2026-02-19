package service_test

import (
	"fmt"
	"regexp"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// fakeFS is a test double for service.FileSystem.
type fakeFS struct {
	dirs  map[string][]string // root → list of relative dir paths
	files map[string][]string // abs dir → list of filenames
	errs  map[string]error    // abs dir → error to return
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

var _ = Describe("Scanner", func() {
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

	Describe("Scan", func() {
		Context("with no matching directories", func() {
			It("returns empty results", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"other/dir"}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(BeEmpty())
				Expect(result.Dimensions).To(BeEmpty())
			})
		})

		Context("with matching directories containing images", func() {
			It("parses query-encoded filenames into dimensions", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].RelativePath).To(Equal("test/run1/index=5&prompt_name=portal_hub&seed=422&cfg=3&_00001_.png"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("index", "5"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("prompt_name", "portal_hub"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("seed", "422"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("cfg", "3"))
			})

			It("discovers dimensions with unique values", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=1&cfg=3&_00001_.png",
					"seed=2&cfg=3&_00001_.png",
					"seed=1&cfg=7&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap).To(HaveKey("seed"))
				Expect(dimMap).To(HaveKey("cfg"))
				Expect(dimMap["seed"].Values).To(Equal([]string{"1", "2"}))
				Expect(dimMap["cfg"].Values).To(Equal([]string{"3", "7"}))
			})
		})

		Context("batch deduplication", func() {
			It("uses the highest batch number when duplicates exist", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=1&cfg=3&_00001_.png",
					"seed=1&cfg=3&_00003_.png",
					"seed=1&cfg=3&_00002_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].RelativePath).To(Equal("test/run1/seed=1&cfg=3&_00003_.png"))
			})

			It("keeps images with different dimensions even if same batch number", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=1&cfg=3&_00001_.png",
					"seed=2&cfg=3&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(2))
			})
		})

		Context("directory dimension extraction", func() {
			It("applies regex capture groups to extract dimension values", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^psyart/.+`),
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
				}
				fs.dirs[root] = []string{
					"psyart/qwen/run-steps-1000-checkpoint-a",
					"psyart/qwen/run-steps-2000-checkpoint-b",
				}
				fs.files["/data/dataset/psyart/qwen/run-steps-1000-checkpoint-a"] = []string{
					"seed=1&_00001_.png",
				}
				fs.files["/data/dataset/psyart/qwen/run-steps-2000-checkpoint-b"] = []string{
					"seed=1&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(2))

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap).To(HaveKey("step"))
				Expect(dimMap["step"].Type).To(Equal(model.DimensionTypeInt))
				Expect(dimMap["step"].Values).To(Equal([]string{"1000", "2000"}))

				Expect(dimMap).To(HaveKey("checkpoint"))
				Expect(dimMap["checkpoint"].Values).To(ConsistOf(
					"run-steps-1000-checkpoint-a",
					"run-steps-2000-checkpoint-b",
				))
			})

			It("merges directory and filename dimensions per image", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
					Dimensions: []model.DimensionConfig{
						{
							Name:    "step",
							Type:    model.DimensionTypeInt,
							Pattern: regexp.MustCompile(`steps-(\d+)`),
						},
					},
				}
				fs.dirs[root] = []string{"test/steps-500"}
				fs.files["/data/dataset/test/steps-500"] = []string{
					"seed=42&cfg=3&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("step", "500"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("seed", "42"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("cfg", "3"))
			})
		})

		Context("dimension type inference", func() {
			It("infers int type for numeric filename dimensions", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=42&prompt_name=test&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap["seed"].Type).To(Equal(model.DimensionTypeInt))
				Expect(dimMap["prompt_name"].Type).To(Equal(model.DimensionTypeString))
			})
		})

		Context("dimension value sorting", func() {
			It("sorts int dimensions numerically", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"step=100&_00001_.png",
					"step=20&_00001_.png",
					"step=3&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())

				dimMap := make(map[string]model.Dimension)
				for _, d := range result.Dimensions {
					dimMap[d.Name] = d
				}

				Expect(dimMap["step"].Values).To(Equal([]string{"3", "20", "100"}))
			})

			It("sorts string dimensions lexicographically", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"prompt=charlie&_00001_.png",
					"prompt=alpha&_00001_.png",
					"prompt=bravo&_00001_.png",
				}

				result, err := scanner.Scan(tr)

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
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.errs["/data/dataset/test/run1"] = fmt.Errorf("permission denied")

				_, err := scanner.Scan(tr)

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("permission denied"))
			})
		})

		Context("edge cases", func() {
			It("skips non-PNG files", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=1&_00001_.png",
					"readme.txt",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				// readme.txt would be returned by ListPNGFiles in real impl,
				// but scanner's parseFilename handles .png check
				Expect(result.Images).To(HaveLen(1))
			})

			It("handles filenames without batch suffix", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=1&cfg=3.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(1))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("seed", "1"))
				Expect(result.Images[0].Dimensions).To(HaveKeyWithValue("cfg", "3"))
			})

			It("returns deterministic ordering of images by path", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"seed=3&_00001_.png",
					"seed=1&_00001_.png",
					"seed=2&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Images).To(HaveLen(3))
				// Should be sorted by relative path
				Expect(result.Images[0].RelativePath).To(ContainSubstring("seed=1"))
				Expect(result.Images[1].RelativePath).To(ContainSubstring("seed=2"))
				Expect(result.Images[2].RelativePath).To(ContainSubstring("seed=3"))
			})

			It("returns deterministic ordering of dimensions by name", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
				}
				fs.dirs[root] = []string{"test/run1"}
				fs.files["/data/dataset/test/run1"] = []string{
					"zebra=1&alpha=2&middle=3&_00001_.png",
				}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Dimensions).To(HaveLen(3))
				Expect(result.Dimensions[0].Name).To(Equal("alpha"))
				Expect(result.Dimensions[1].Name).To(Equal("middle"))
				Expect(result.Dimensions[2].Name).To(Equal("zebra"))
			})

			It("handles multiple directories with same filename dimension values", func() {
				tr := model.TrainingRunConfig{
					Name:    "test-run",
					Pattern: regexp.MustCompile(`^test/.+`),
					Dimensions: []model.DimensionConfig{
						{
							Name:    "step",
							Type:    model.DimensionTypeInt,
							Pattern: regexp.MustCompile(`steps-(\d+)`),
						},
					},
				}
				fs.dirs[root] = []string{"test/steps-100", "test/steps-200"}
				fs.files["/data/dataset/test/steps-100"] = []string{"seed=1&_00001_.png"}
				fs.files["/data/dataset/test/steps-200"] = []string{"seed=1&_00001_.png"}

				result, err := scanner.Scan(tr)

				Expect(err).NotTo(HaveOccurred())
				// Different step dimensions → different images (different dedup keys)
				Expect(result.Images).To(HaveLen(2))
			})
		})
	})
})
