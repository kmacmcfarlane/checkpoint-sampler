package service_test

import (
	"image/png"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeFS implements service.DemoFileSystem for testing.
type fakeFS struct {
	dirs map[string]bool
}

func (f *fakeFS) DirectoryExists(path string) bool {
	return f.dirs[path]
}

// fakeDemoPresetStore implements service.DemoPresetStore for testing.
type fakeDemoPresetStore struct {
	presets []model.Preset
}

func (f *fakeDemoPresetStore) ListPresets() ([]model.Preset, error) {
	return f.presets, nil
}

func (f *fakeDemoPresetStore) CreatePreset(p model.Preset) error {
	f.presets = append(f.presets, p)
	return nil
}

func (f *fakeDemoPresetStore) DeletePreset(id string) error {
	for i, p := range f.presets {
		if p.ID == id {
			f.presets = append(f.presets[:i], f.presets[i+1:]...)
			return nil
		}
	}
	return nil
}

var _ = Describe("DemoService", func() {
	var (
		sampleDir   string
		fs          *fakeFS
		presetStore *fakeDemoPresetStore
		svc         *service.DemoService
		logger      *logrus.Logger
	)

	BeforeEach(func() {
		var err error
		sampleDir, err = os.MkdirTemp("", "demo-test-*")
		Expect(err).NotTo(HaveOccurred())

		fs = &fakeFS{dirs: make(map[string]bool)}
		presetStore = &fakeDemoPresetStore{}
		logger = logrus.New()
		logger.SetLevel(logrus.FatalLevel)
		svc = service.NewDemoService(fs, presetStore, sampleDir, logger)
	})

	AfterEach(func() {
		os.RemoveAll(sampleDir)
	})

	Describe("Status", func() {
		// AC: Demo dataset is visible and browsable out of the box
		It("returns installed=false when demo directory does not exist", func() {
			status := svc.Status()
			Expect(status.Installed).To(BeFalse())
		})

		It("returns installed=true when demo study directory exists", func() {
			// New layout: sample_dir/demo-model/demo-study/
			demoStudyDir := filepath.Join(sampleDir, model.DemoTrainingRunName, model.DemoStudyOutputDir)
			fs.dirs[demoStudyDir] = true
			status := svc.Status()
			Expect(status.Installed).To(BeTrue())
		})
	})

	Describe("Install", func() {
		// AC: Application ships with a bundled demo dataset (small set of pre-generated sample images)
		It("creates demo directory structure with training run and study subdirectories", func() {
			err := svc.Install()
			Expect(err).NotTo(HaveOccurred())

			// Verify training run dir exists: sample_dir/demo-model/
			trainingRunDir := filepath.Join(sampleDir, model.DemoTrainingRunName)
			info, err := os.Stat(trainingRunDir)
			Expect(err).NotTo(HaveOccurred())
			Expect(info.IsDir()).To(BeTrue())

			// Verify study output dir exists: sample_dir/demo-model/demo-study/
			studyDir := filepath.Join(sampleDir, model.DemoTrainingRunName, model.DemoStudyOutputDir)
			info, err = os.Stat(studyDir)
			Expect(err).NotTo(HaveOccurred())
			Expect(info.IsDir()).To(BeTrue())

			// Verify checkpoint directories exist under study dir
			expectedCheckpoints := []string{
				"demo-model-step00001000.safetensors",
				"demo-model-step00002000.safetensors",
				"demo-model-step00003000.safetensors",
			}
			for _, cp := range expectedCheckpoints {
				cpDir := filepath.Join(sampleDir, model.DemoTrainingRunName, model.DemoStudyOutputDir, cp)
				info, err := os.Stat(cpDir)
				Expect(err).NotTo(HaveOccurred())
				Expect(info.IsDir()).To(BeTrue())
			}
		})

		It("creates valid PNG images with query-encoded filenames", func() {
			err := svc.Install()
			Expect(err).NotTo(HaveOccurred())

			// Check a specific image exists and is a valid PNG (new layout)
			imgPath := filepath.Join(sampleDir, model.DemoTrainingRunName, model.DemoStudyOutputDir,
				"demo-model-step00001000.safetensors",
				"prompt_name=landscape&seed=42&cfg=1&_00001_.png")
			f, err := os.Open(imgPath)
			Expect(err).NotTo(HaveOccurred())
			defer f.Close()

			// Decode as PNG to verify it's valid
			img, err := png.Decode(f)
			Expect(err).NotTo(HaveOccurred())
			Expect(img.Bounds().Dx()).To(Equal(64))
			Expect(img.Bounds().Dy()).To(Equal(64))
		})

		It("generates images across all dimension combinations", func() {
			err := svc.Install()
			Expect(err).NotTo(HaveOccurred())

			// 3 checkpoints x 2 prompts x 2 seeds x 2 cfgs = 24 images
			count := 0
			cpDir := filepath.Join(sampleDir, model.DemoTrainingRunName, model.DemoStudyOutputDir, "demo-model-step00001000.safetensors")
			entries, err := os.ReadDir(cpDir)
			Expect(err).NotTo(HaveOccurred())
			for _, entry := range entries {
				if !entry.IsDir() {
					count++
				}
			}
			// 2 prompts x 2 seeds x 2 cfgs = 8 images per checkpoint
			Expect(count).To(Equal(8))
		})

		// AC: Demo dimension preset is seeded into the database on first run
		It("seeds the demo dimension preset", func() {
			err := svc.Install()
			Expect(err).NotTo(HaveOccurred())

			Expect(presetStore.presets).To(HaveLen(1))
			Expect(presetStore.presets[0].Name).To(Equal(model.DemoPresetName))
			Expect(presetStore.presets[0].Mapping.X).To(Equal("cfg"))
			Expect(presetStore.presets[0].Mapping.Y).To(Equal("prompt_name"))
			Expect(presetStore.presets[0].Mapping.Slider).To(Equal("checkpoint"))
			Expect(presetStore.presets[0].Mapping.Combos).To(Equal([]string{"seed"}))
		})

		It("is idempotent - does not recreate if directory already exists", func() {
			// Create the demo study output directory manually (new layout)
			demoStudyDir := filepath.Join(sampleDir, model.DemoTrainingRunName, model.DemoStudyOutputDir)
			err := os.MkdirAll(demoStudyDir, 0755)
			Expect(err).NotTo(HaveOccurred())

			// Update fake fs to reflect the directory exists
			fs.dirs[demoStudyDir] = true

			err = svc.Install()
			Expect(err).NotTo(HaveOccurred())

			// Should not have created presets (skipped entirely)
			Expect(presetStore.presets).To(HaveLen(0))
		})

		It("does not duplicate the preset on repeated installs", func() {
			err := svc.Install()
			Expect(err).NotTo(HaveOccurred())
			Expect(presetStore.presets).To(HaveLen(1))

			// Remove the training run directory to allow reinstall
			os.RemoveAll(filepath.Join(sampleDir, model.DemoTrainingRunName))

			err = svc.Install()
			Expect(err).NotTo(HaveOccurred())
			// Preset should still be just 1 (seed detects existing by name)
			Expect(presetStore.presets).To(HaveLen(1))
		})
	})

	Describe("Uninstall", func() {
		BeforeEach(func() {
			// Install first
			err := svc.Install()
			Expect(err).NotTo(HaveOccurred())
		})

		// AC: Demo dataset is deletable from the UI
		It("removes the demo training run directory (and study subdirectory)", func() {
			err := svc.Uninstall()
			Expect(err).NotTo(HaveOccurred())

			// Training run directory should be gone
			_, err = os.Stat(filepath.Join(sampleDir, model.DemoTrainingRunName))
			Expect(os.IsNotExist(err)).To(BeTrue())
		})

		It("removes the demo preset", func() {
			Expect(presetStore.presets).To(HaveLen(1))

			err := svc.Uninstall()
			Expect(err).NotTo(HaveOccurred())

			Expect(presetStore.presets).To(HaveLen(0))
		})

		It("does not error when demo directory does not exist", func() {
			// Uninstall once
			err := svc.Uninstall()
			Expect(err).NotTo(HaveOccurred())

			// Uninstall again - should not error
			err = svc.Uninstall()
			Expect(err).NotTo(HaveOccurred())
		})
	})
})
