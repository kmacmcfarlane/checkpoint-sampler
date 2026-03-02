package service_test

import (
	"fmt"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeViewerFS implements service.ViewerFileSystem for testing.
type fakeViewerFS struct {
	subdirs map[string][]string // dir path → list of subdirectory names
	errs    map[string]error    // dir path → error to return
}

func newFakeViewerFS() *fakeViewerFS {
	return &fakeViewerFS{
		subdirs: make(map[string][]string),
		errs:    make(map[string]error),
	}
}

func (f *fakeViewerFS) ListSubdirectories(root string) ([]string, error) {
	if err, ok := f.errs[root]; ok {
		return nil, err
	}
	return f.subdirs[root], nil
}

func (f *fakeViewerFS) DirectoryExists(path string) bool {
	_, ok := f.subdirs[path]
	return ok
}

var _ = Describe("ViewerDiscoveryService", func() {
	var (
		fs     *fakeViewerFS
		svc    *service.ViewerDiscoveryService
		logger *logrus.Logger
	)

	BeforeEach(func() {
		fs = newFakeViewerFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	Describe("DiscoverViewable", func() {
		// AC1: Scanner discovers viewable content from sample output directories
		Context("legacy (root-level) checkpoint directories", func() {
			It("discovers training runs from .safetensors directories at root of sample_dir", func() {
				fs.subdirs["/samples"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
					"model.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("model"))
				Expect(runs[0].Checkpoints).To(HaveLen(3))
				Expect(runs[0].HasSamples).To(BeTrue())
			})

			It("creates separate training runs for different base names", func() {
				fs.subdirs["/samples"] = []string{
					"model-a-step00001000.safetensors",
					"model-b.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				Expect(runs[0].Name).To(Equal("model-a"))
				Expect(runs[1].Name).To(Equal("model-b"))
			})
		})

		// AC2: Training runs for the viewer are derived from the directory structure under sample_dir
		Context("study-scoped checkpoint directories", func() {
			It("discovers training runs under study subdirectories", func() {
				fs.subdirs["/samples"] = []string{"my-study"}
				fs.subdirs["/samples/my-study"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("my-study/model"))
				Expect(runs[0].Checkpoints).To(HaveLen(2))
				Expect(runs[0].HasSamples).To(BeTrue())
			})

			It("handles multiple studies with different training runs", func() {
				fs.subdirs["/samples"] = []string{"study-a", "study-b"}
				fs.subdirs["/samples/study-a"] = []string{
					"model-x.safetensors",
				}
				fs.subdirs["/samples/study-b"] = []string{
					"model-y.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				Expect(runs[0].Name).To(Equal("study-a/model-x"))
				Expect(runs[1].Name).To(Equal("study-b/model-y"))
			})

			It("groups checkpoints within a study into the same training run", func() {
				fs.subdirs["/samples"] = []string{"my-study"}
				fs.subdirs["/samples/my-study"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
					"model.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("my-study/model"))
				Expect(runs[0].Checkpoints).To(HaveLen(3))
			})
		})

		Context("mixed legacy and study directories", func() {
			It("discovers both legacy and study-scoped training runs", func() {
				fs.subdirs["/samples"] = []string{
					"legacy-model.safetensors",
					"my-study",
				}
				fs.subdirs["/samples/my-study"] = []string{
					"study-model.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				Expect(runs[0].Name).To(Equal("legacy-model"))
				Expect(runs[1].Name).To(Equal("my-study/study-model"))
			})
		})

		Context("step number extraction and ordering", func() {
			It("extracts step numbers and sorts checkpoints correctly", func() {
				fs.subdirs["/samples"] = []string{
					"model.safetensors",
					"model-step00005000.safetensors",
					"model-step00001000.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				cps := runs[0].Checkpoints
				Expect(cps).To(HaveLen(3))
				Expect(cps[0].StepNumber).To(Equal(1000))
				Expect(cps[1].StepNumber).To(Equal(5000))
				// Final checkpoint gets max step (5000) when detectable
				Expect(cps[2].StepNumber).To(Equal(5000))
			})

			It("extracts epoch suffix correctly", func() {
				fs.subdirs["/samples"] = []string{
					"model-000104.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].StepNumber).To(Equal(104))
			})
		})

		Context("all checkpoints always have samples", func() {
			It("sets HasSamples=true on all checkpoints", func() {
				fs.subdirs["/samples"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				for _, cp := range runs[0].Checkpoints {
					Expect(cp.HasSamples).To(BeTrue(), "checkpoint %s should have HasSamples=true", cp.Filename)
				}
			})

			It("sets HasSamples=true on training run", func() {
				fs.subdirs["/samples"] = []string{
					"model.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].HasSamples).To(BeTrue())
			})
		})

		Context("empty directories", func() {
			It("returns empty results when sample_dir has no subdirectories", func() {
				fs.subdirs["/samples"] = []string{}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(BeEmpty())
			})

			It("returns empty results when study has no checkpoint directories", func() {
				fs.subdirs["/samples"] = []string{"empty-study"}
				fs.subdirs["/samples/empty-study"] = []string{}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(BeEmpty())
			})
		})

		Context("deterministic ordering", func() {
			It("returns training runs sorted by name", func() {
				fs.subdirs["/samples"] = []string{
					"zeta.safetensors",
					"alpha.safetensors",
					"middle.safetensors",
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(3))
				Expect(runs[0].Name).To(Equal("alpha"))
				Expect(runs[1].Name).To(Equal("middle"))
				Expect(runs[2].Name).To(Equal("zeta"))
			})
		})

		Context("error handling", func() {
			It("returns error when listing sample_dir fails", func() {
				fs.errs["/samples"] = fmt.Errorf("permission denied")
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				_, err := svc.DiscoverViewable()

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("permission denied"))
			})

			It("returns error when listing study directory fails", func() {
				fs.subdirs["/samples"] = []string{"broken-study"}
				fs.errs["/samples/broken-study"] = fmt.Errorf("io error")
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				_, err := svc.DiscoverViewable()

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("io error"))
			})
		})

		Context("ignores non-checkpoint directories within studies", func() {
			It("skips non-.safetensors directories inside study directories", func() {
				fs.subdirs["/samples"] = []string{"my-study"}
				fs.subdirs["/samples/my-study"] = []string{
					"model.safetensors",
					"some-other-dir", // not a checkpoint dir
				}
				svc = service.NewViewerDiscoveryService(fs, "/samples", logger)

				runs, err := svc.DiscoverViewable()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Checkpoints).To(HaveLen(1))
			})
		})
	})

	Describe("StudyNameForRun", func() {
		It("returns the study prefix for a study-scoped run", func() {
			Expect(service.StudyNameForRun("my-study/model")).To(Equal("my-study"))
		})

		It("returns empty string for a legacy run", func() {
			Expect(service.StudyNameForRun("model")).To(Equal(""))
		})

		It("handles multiple path segments", func() {
			Expect(service.StudyNameForRun("a/b/c")).To(Equal("a/b"))
		})
	})
})
