package service_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeCheckpointFS implements service.CheckpointFileSystem for testing.
type fakeCheckpointFS struct {
	files map[string][]string // root → list of relative file paths
	dirs  map[string]bool     // path → exists
}

func newFakeCheckpointFS() *fakeCheckpointFS {
	return &fakeCheckpointFS{
		files: make(map[string][]string),
		dirs:  make(map[string]bool),
	}
}

func (f *fakeCheckpointFS) ListSafetensorsFiles(root string) ([]string, error) {
	return f.files[root], nil
}

func (f *fakeCheckpointFS) DirectoryExists(path string) bool {
	return f.dirs[path]
}

var _ = Describe("DiscoveryService", func() {
	var (
		fs        *fakeCheckpointFS
		discovery *service.DiscoveryService
	)

	BeforeEach(func() {
		fs = newFakeCheckpointFS()
	})

	Describe("Discover", func() {
		Context("suffix stripping and grouping", func() {
			It("groups checkpoint files by base name after stripping step suffix", func() {
				fs.files["/checkpoints"] = []string{
					"qwen/model-v1.safetensors",
					"qwen/model-v1-step00004500.safetensors",
					"qwen/model-v1-step00005000.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("qwen/model-v1"))
				Expect(runs[0].Checkpoints).To(HaveLen(3))
			})

			It("groups checkpoint files by base name after stripping epoch suffix", func() {
				fs.files["/checkpoints"] = []string{
					"model-v2.safetensors",
					"model-v2-000104.safetensors",
					"model-v2-000208.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("model-v2"))
				Expect(runs[0].Checkpoints).To(HaveLen(3))
			})

			It("creates separate training runs for different base names", func() {
				fs.files["/checkpoints"] = []string{
					"model-a.safetensors",
					"model-a-step00001000.safetensors",
					"model-b.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				// Sorted by name
				Expect(runs[0].Name).To(Equal("model-a"))
				Expect(runs[0].Checkpoints).To(HaveLen(2))
				Expect(runs[1].Name).To(Equal("model-b"))
				Expect(runs[1].Checkpoints).To(HaveLen(1))
			})
		})

		Context("step number extraction", func() {
			It("extracts step number from -step suffix", func() {
				fs.files["/checkpoints"] = []string{
					"model-step00004500.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].StepNumber).To(Equal(4500))
			})

			It("extracts step number from epoch suffix", func() {
				fs.files["/checkpoints"] = []string{
					"model-000104.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].StepNumber).To(Equal(104))
			})

			It("returns -1 for final checkpoint (no suffix)", func() {
				fs.files["/checkpoints"] = []string{
					"model.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].StepNumber).To(Equal(-1))
			})

			It("sorts checkpoints by step number with final checkpoint last", func() {
				fs.files["/checkpoints"] = []string{
					"model.safetensors",
					"model-step00001000.safetensors",
					"model-step00000500.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				cps := runs[0].Checkpoints
				Expect(cps).To(HaveLen(3))
				Expect(cps[0].StepNumber).To(Equal(500))
				Expect(cps[1].StepNumber).To(Equal(1000))
				// Final checkpoint gets max step (1000) when detectable
				Expect(cps[2].StepNumber).To(Equal(1000))
			})
		})

		Context("sample directory correlation", func() {
			It("sets has_samples when matching sample directory exists", func() {
				fs.files["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				fs.dirs["/samples/model-step00001000.safetensors"] = true
				// model-step00002000.safetensors has no sample dir
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].HasSamples).To(BeTrue())

				cpMap := make(map[string]bool)
				for _, cp := range runs[0].Checkpoints {
					cpMap[cp.Filename] = cp.HasSamples
				}
				Expect(cpMap["model-step00001000.safetensors"]).To(BeTrue())
				Expect(cpMap["model-step00002000.safetensors"]).To(BeFalse())
			})

			It("sets has_samples=false on training run when no checkpoints have samples", func() {
				fs.files["/checkpoints"] = []string{
					"model.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].HasSamples).To(BeFalse())
			})
		})

		Context("multiple checkpoint directories", func() {
			It("scans all checkpoint directories", func() {
				fs.files["/checkpoints1"] = []string{
					"model-a.safetensors",
				}
				fs.files["/checkpoints2"] = []string{
					"model-b.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints1", "/checkpoints2"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
			})

			It("tracks checkpoint directory index correctly", func() {
				fs.files["/checkpoints1"] = []string{
					"model.safetensors",
				}
				fs.files["/checkpoints2"] = []string{
					"other.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints1", "/checkpoints2"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				for _, r := range runs {
					if r.Name == "model" {
						Expect(r.Checkpoints[0].CheckpointDirIndex).To(Equal(0))
					} else {
						Expect(r.Checkpoints[0].CheckpointDirIndex).To(Equal(1))
					}
				}
			})
		})

		Context("empty directories", func() {
			It("returns empty results when no safetensors files found", func() {
				fs.files["/checkpoints"] = []string{}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(BeEmpty())
			})
		})

		Context("deterministic ordering", func() {
			It("returns training runs sorted by name", func() {
				fs.files["/checkpoints"] = []string{
					"zeta.safetensors",
					"alpha.safetensors",
					"middle.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(3))
				Expect(runs[0].Name).To(Equal("alpha"))
				Expect(runs[1].Name).To(Equal("middle"))
				Expect(runs[2].Name).To(Equal("zeta"))
			})
		})

		Context("directory path preservation", func() {
			It("includes relative directory path in training run name", func() {
				fs.files["/checkpoints"] = []string{
					"sub/dir/model.safetensors",
					"sub/dir/model-step00001000.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("sub/dir/model"))
			})
		})

		Context("sample correlation uses filename only (not path)", func() {
			It("matches sample directory against checkpoint filename not full path", func() {
				fs.files["/checkpoints"] = []string{
					"sub/dir/model-step00001000.safetensors",
				}
				// Sample dir matches the filename, not the full path
				fs.dirs["/samples/model-step00001000.safetensors"] = true
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, "/samples")

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].HasSamples).To(BeTrue())
			})
		})
	})
})
