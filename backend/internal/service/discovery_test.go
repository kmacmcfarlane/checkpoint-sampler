package service_test

import (
	"fmt"
	"io"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// padStep formats a step number as a zero-padded 8-digit string, matching the
// -step<NNNNNNNN> checkpoint filename suffix convention.
func padStep(n int) string {
	return fmt.Sprintf("%08d", n)
}

// fakeCheckpointFS implements service.CheckpointFileSystem for testing.
type fakeCheckpointFS struct {
	files   map[string][]string // root → list of relative file paths
	dirs    map[string]bool     // path → exists
	subdirs map[string][]string // root → list of immediate subdirectory names
}

func newFakeCheckpointFS() *fakeCheckpointFS {
	return &fakeCheckpointFS{
		files:   make(map[string][]string),
		dirs:    make(map[string]bool),
		subdirs: make(map[string][]string),
	}
}

func (f *fakeCheckpointFS) ListSafetensorsFiles(root string) ([]string, error) {
	return f.files[root], nil
}

func (f *fakeCheckpointFS) DirectoryExists(path string) bool {
	return f.dirs[path]
}

func (f *fakeCheckpointFS) ListSubdirectories(root string) ([]string, error) {
	return f.subdirs[root], nil
}

var _ = Describe("DiscoveryService", func() {
	var (
		fs        *fakeCheckpointFS
		discovery *service.DiscoveryService
		logger    *logrus.Logger
	)

	BeforeEach(func() {
		fs = newFakeCheckpointFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	Describe("Discover", func() {
		Context("suffix stripping and grouping", func() {
			It("groups checkpoint files by base name after stripping step suffix", func() {
				fs.files["/checkpoints"] = []string{
					"qwen/model-v1.safetensors",
					"qwen/model-v1-step00004500.safetensors",
					"qwen/model-v1-step00005000.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].StepNumber).To(Equal(4500))
			})

			It("extracts step number from epoch suffix", func() {
				fs.files["/checkpoints"] = []string{
					"model-000104.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].StepNumber).To(Equal(104))
			})

			It("returns -1 for final checkpoint (no suffix)", func() {
				fs.files["/checkpoints"] = []string{
					"model.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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

		Context("final checkpoint step from run name (B-161)", func() {
			It("assigns the final checkpoint the epoch count from an 'epochs-N' run name, not colliding with the max numbered epoch", func() {
				base := "bidi-lora-dim-32-alpha-32-lr-5e-5-epochs-100-1024-b1d1"
				fs.files["/checkpoints"] = []string{
					base + ".safetensors",
					base + "-000010.safetensors",
					base + "-000020.safetensors",
					base + "-000030.safetensors",
					base + "-000040.safetensors",
					base + "-000050.safetensors",
					base + "-000060.safetensors",
					base + "-000070.safetensors",
					base + "-000080.safetensors",
					base + "-000090.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				cps := runs[0].Checkpoints
				Expect(cps).To(HaveLen(10))

				steps := make([]int, len(cps))
				for i, cp := range cps {
					steps[i] = cp.StepNumber
				}
				Expect(steps).To(Equal([]int{10, 20, 30, 40, 50, 60, 70, 80, 90, 100}))

				// The unsuffixed final checkpoint must map to 100, and must not collide
				// with the real -000090 checkpoint's StepNumber.
				lastCP := cps[len(cps)-1]
				Expect(lastCP.StepNumber).To(Equal(100))
				Expect(lastCP.Filename).To(Equal(base + ".safetensors"))
			})

			DescribeTable("final checkpoint StepNumber resolution from run name tokens",
				func(runNameSuffix string, numberedSteps []int, expectedFinalStep int) {
					base := "run-" + runNameSuffix
					files := []string{base + ".safetensors"}
					for _, s := range numberedSteps {
						files = append(files, base+"-step"+padStep(s)+".safetensors")
					}
					fs.files["/checkpoints"] = files
					discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

					runs, err := discovery.Discover()

					Expect(err).NotTo(HaveOccurred())
					Expect(runs).To(HaveLen(1))
					cps := runs[0].Checkpoints
					finalCP := cps[len(cps)-1]
					Expect(finalCP.Filename).To(Equal(base + ".safetensors"))
					Expect(finalCP.StepNumber).To(Equal(expectedFinalStep))
				},
				Entry("epochs-N token", "epochs-100", []int{10, 50}, 100),
				Entry("epoch-N (singular) token", "epoch-100", []int{10, 50}, 100),
				Entry("steps-N token (existing behavior unchanged)", "steps-9000", []int{500, 1000}, 9000),
				Entry("no token falls back to numbered max", "plain-name", []int{10, 50}, 50),
				Entry("epochs-N larger than numbered max wins", "epochs-100", []int{10, 20}, 100),
				Entry("guard: dim/alpha/lr/resolution tokens are not mistaken for epoch count", "dim-32-alpha-32-lr-5e-5-1024", []int{10, 50}, 50),
			)
		})

		Context("sample directory correlation", func() {
			It("sets has_samples when matching sample directory exists", func() {
				fs.files["/checkpoints"] = []string{
					"model-step00001000.safetensors",
					"model-step00002000.safetensors",
				}
				fs.dirs["/samples/model-step00001000.safetensors"] = true
				// model-step00002000.safetensors has no sample dir
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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

			// B-144: LoRA sample output is nested under an additional {base_model_name}
			// directory level. Detection must find these directories, not only the flat
			// legacy {sampleDir}/{filename} path.
			It("detects samples in the LoRA layout (run/study/base_model/checkpoint)", func() {
				fs.files["/loras"] = []string{
					"my-lora-step00001000.safetensors",
				}
				// Sample tree: /samples/my-lora/study-abc/sd15/my-lora-step00001000.safetensors/
				fs.subdirs["/samples"] = []string{"my-lora"}
				fs.subdirs["/samples/my-lora"] = []string{"study-abc"}
				fs.subdirs["/samples/my-lora/study-abc"] = []string{"sd15"}
				fs.subdirs["/samples/my-lora/study-abc/sd15"] = []string{"my-lora-step00001000.safetensors"}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].HasSamples).To(BeTrue())
				Expect(runs[0].Checkpoints[0].HasSamples).To(BeTrue())
			})

			// B-144 regression: non-LoRA checkpoint-run layout
			// (run/study/checkpoint) must still be detected.
			It("detects samples in the checkpoint-run layout (run/study/checkpoint)", func() {
				fs.files["/checkpoints"] = []string{
					"qwen/model-step00002000.safetensors",
				}
				// Sample tree: /samples/qwen_model/my-study/model-step00002000.safetensors/
				fs.subdirs["/samples"] = []string{"qwen_model"}
				fs.subdirs["/samples/qwen_model"] = []string{"my-study"}
				fs.subdirs["/samples/qwen_model/my-study"] = []string{"model-step00002000.safetensors"}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].HasSamples).To(BeTrue())
				Expect(runs[0].Checkpoints[0].HasSamples).To(BeTrue())
			})

			// B-144 regression: legacy study layout ({study}/{checkpoint}) still detected.
			It("detects samples in the legacy study layout (study/checkpoint)", func() {
				fs.files["/checkpoints"] = []string{
					"model-step00003000.safetensors",
				}
				fs.subdirs["/samples"] = []string{"legacy-study"}
				fs.subdirs["/samples/legacy-study"] = []string{"model-step00003000.safetensors"}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].HasSamples).To(BeTrue())
				Expect(runs[0].Checkpoints[0].HasSamples).To(BeTrue())
			})

			// B-144 regression: a checkpoint with samples nested under one layout
			// must not mark a different checkpoint (same run) that has none.
			It("only marks checkpoints whose sample directory exists in the tree", func() {
				fs.files["/loras"] = []string{
					"my-lora-step00001000.safetensors",
					"my-lora-step00002000.safetensors",
				}
				fs.subdirs["/samples"] = []string{"my-lora"}
				fs.subdirs["/samples/my-lora"] = []string{"study-abc"}
				fs.subdirs["/samples/my-lora/study-abc"] = []string{"sd15"}
				// Only the step-1000 checkpoint has a sample directory.
				fs.subdirs["/samples/my-lora/study-abc/sd15"] = []string{"my-lora-step00001000.safetensors"}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].HasSamples).To(BeTrue())
				cpMap := make(map[string]bool)
				for _, cp := range runs[0].Checkpoints {
					cpMap[cp.Filename] = cp.HasSamples
				}
				Expect(cpMap["my-lora-step00001000.safetensors"]).To(BeTrue())
				Expect(cpMap["my-lora-step00002000.safetensors"]).To(BeFalse())
			})

			It("sets has_samples=false on training run when no checkpoints have samples", func() {
				fs.files["/checkpoints"] = []string{
					"model.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints1", "/checkpoints2"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints1", "/checkpoints2"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

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
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs[0].Checkpoints[0].HasSamples).To(BeTrue())
			})
		})

		Context("Kind assignment", func() {
			It("assigns TrainingRunKindCheckpoint to runs from checkpoint_dirs", func() {
				fs.files["/checkpoints"] = []string{
					"model-a.safetensors",
					"model-a-step00001000.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Kind).To(Equal(model.TrainingRunKindCheckpoint))
			})

			It("assigns TrainingRunKindLoRA to runs from lora_dirs", func() {
				fs.files["/loras"] = []string{
					"my-lora.safetensors",
					"my-lora-step00001000.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Kind).To(Equal(model.TrainingRunKindLoRA))
			})

			It("assigns correct Kind when both checkpoint and lora dirs are scanned", func() {
				fs.files["/checkpoints"] = []string{
					"checkpoint-model.safetensors",
				}
				fs.files["/loras"] = []string{
					"lora-adapter.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				// Sorted by name: checkpoint-model, lora-adapter
				Expect(runs[0].Name).To(Equal("checkpoint-model"))
				Expect(runs[0].Kind).To(Equal(model.TrainingRunKindCheckpoint))
				Expect(runs[1].Name).To(Equal("lora-adapter"))
				Expect(runs[1].Kind).To(Equal(model.TrainingRunKindLoRA))
			})
		})

		Context("LoRA directory scanning", func() {
			It("scans lora_dirs separately from checkpoint_dirs", func() {
				fs.files["/checkpoints"] = []string{
					"model-a.safetensors",
				}
				fs.files["/loras"] = []string{
					"lora-b.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
			})

			It("applies step suffix stripping to LoRA files", func() {
				fs.files["/loras"] = []string{
					"my-lora.safetensors",
					"my-lora-step00001000.safetensors",
					"my-lora-step00002000.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("my-lora"))
				Expect(runs[0].Checkpoints).To(HaveLen(3))
			})

			It("applies epoch suffix stripping to LoRA files", func() {
				fs.files["/loras"] = []string{
					"my-lora.safetensors",
					"my-lora-000104.safetensors",
					"my-lora-000208.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(1))
				Expect(runs[0].Name).To(Equal("my-lora"))
				Expect(runs[0].Checkpoints).To(HaveLen(3))
			})

			It("groups LoRA files by relative directory path", func() {
				fs.files["/loras"] = []string{
					"project-a/lora-v1.safetensors",
					"project-a/lora-v1-step00001000.safetensors",
					"project-b/lora-v2.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				Expect(runs[0].Name).To(Equal("project-a/lora-v1"))
				Expect(runs[0].Kind).To(Equal(model.TrainingRunKindLoRA))
				Expect(runs[1].Name).To(Equal("project-b/lora-v2"))
				Expect(runs[1].Kind).To(Equal(model.TrainingRunKindLoRA))
			})

			It("handles multiple lora_dirs", func() {
				fs.files["/loras1"] = []string{
					"lora-a.safetensors",
				}
				fs.files["/loras2"] = []string{
					"lora-b.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, nil, []string{"/loras1", "/loras2"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				Expect(runs[0].Kind).To(Equal(model.TrainingRunKindLoRA))
				Expect(runs[1].Kind).To(Equal(model.TrainingRunKindLoRA))
			})

			It("returns empty results when lora_dirs is nil", func() {
				discovery = service.NewDiscoveryService(fs, nil, nil, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(BeEmpty())
			})

			It("includes LoRA runs in FSState snapshot alongside checkpoint runs", func() {
				fs.files["/checkpoints"] = []string{
					"checkpoint-model.safetensors",
				}
				fs.files["/loras"] = []string{
					"lora-adapter.safetensors",
				}
				discovery = service.NewDiscoveryService(fs, []string{"/checkpoints"}, []string{"/loras"}, "/samples", logger)

				runs, err := discovery.Discover()

				Expect(err).NotTo(HaveOccurred())
				Expect(runs).To(HaveLen(2))
				// Both runs should be in the result
				names := make([]string, len(runs))
				for i, r := range runs {
					names[i] = r.Name
				}
				Expect(names).To(ContainElements("checkpoint-model", "lora-adapter"))
			})
		})
	})
})
