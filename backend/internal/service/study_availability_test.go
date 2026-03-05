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

// fakeAvailabilityFS implements service.StudyAvailabilityFileSystem for testing.
type fakeAvailabilityFS struct {
	subdirs map[string][]string
	dirExist map[string]bool
	errs    map[string]error
}

func newFakeAvailabilityFS() *fakeAvailabilityFS {
	return &fakeAvailabilityFS{
		subdirs:  make(map[string][]string),
		dirExist: make(map[string]bool),
		errs:     make(map[string]error),
	}
}

func (f *fakeAvailabilityFS) ListSubdirectories(root string) ([]string, error) {
	if err, ok := f.errs[root]; ok {
		return nil, err
	}
	dirs, ok := f.subdirs[root]
	if !ok {
		return []string{}, nil
	}
	return dirs, nil
}

func (f *fakeAvailabilityFS) DirectoryExists(path string) bool {
	return f.dirExist[path]
}

var _ = Describe("StudyAvailabilityService", func() {
	var (
		fs        *fakeAvailabilityFS
		sampleDir string
		logger    *logrus.Logger
		svc       *service.StudyAvailabilityService
	)

	BeforeEach(func() {
		sampleDir = "/samples"
		fs = newFakeAvailabilityFS()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		svc = service.NewStudyAvailabilityService(fs, sampleDir, logger)
	})

	// AC5: API returns version list and per-version sample availability for studies
	Describe("GetAvailability", func() {
		It("returns empty versions when no version directories exist", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 1},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			// No subdirectories under /samples/MyStudy
			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].StudyID).To(Equal("s1"))
			Expect(result[0].StudyName).To(Equal("MyStudy"))
			Expect(result[0].Versions).To(BeEmpty())
		})

		It("discovers version directories and marks has_samples=true when checkpoint dirs match", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 2},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
					{Filename: "cp2.safetensors"},
				},
			}

			// Version directories under /samples/MyStudy
			fs.subdirs["/samples/MyStudy"] = []string{"v1", "v2"}
			// v1 has checkpoint dirs matching the training run
			fs.subdirs["/samples/MyStudy/v1"] = []string{"cp1.safetensors", "cp2.safetensors"}
			// v2 has no matching checkpoint dirs
			fs.subdirs["/samples/MyStudy/v2"] = []string{"other-dir"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Versions).To(HaveLen(2))
			Expect(result[0].Versions[0].Version).To(Equal(1))
			Expect(result[0].Versions[0].HasSamples).To(BeTrue())
			Expect(result[0].Versions[1].Version).To(Equal(2))
			Expect(result[0].Versions[1].HasSamples).To(BeFalse())
		})

		It("ignores non-version directories (e.g. 'latest', 'backup')", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 1},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.subdirs["/samples/MyStudy"] = []string{"v1", "latest", "backup", "v2"}
			fs.subdirs["/samples/MyStudy/v1"] = []string{"cp1.safetensors"}
			fs.subdirs["/samples/MyStudy/v2"] = []string{}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result[0].Versions).To(HaveLen(2))
			Expect(result[0].Versions[0].Version).To(Equal(1))
			Expect(result[0].Versions[1].Version).To(Equal(2))
		})

		It("sorts versions in ascending order", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 3},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.subdirs["/samples/MyStudy"] = []string{"v3", "v1", "v2"}
			fs.subdirs["/samples/MyStudy/v1"] = []string{}
			fs.subdirs["/samples/MyStudy/v2"] = []string{}
			fs.subdirs["/samples/MyStudy/v3"] = []string{"cp1.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result[0].Versions).To(HaveLen(3))
			Expect(result[0].Versions[0].Version).To(Equal(1))
			Expect(result[0].Versions[1].Version).To(Equal(2))
			Expect(result[0].Versions[2].Version).To(Equal(3))
			Expect(result[0].Versions[2].HasSamples).To(BeTrue())
		})

		It("handles multiple studies", func() {
			studies := []model.Study{
				{ID: "s1", Name: "StudyA", Version: 1},
				{ID: "s2", Name: "StudyB", Version: 2},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.subdirs["/samples/StudyA"] = []string{"v1"}
			fs.subdirs["/samples/StudyA/v1"] = []string{"cp1.safetensors"}
			fs.subdirs["/samples/StudyB"] = []string{"v1", "v2"}
			fs.subdirs["/samples/StudyB/v1"] = []string{}
			fs.subdirs["/samples/StudyB/v2"] = []string{"cp1.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))

			Expect(result[0].StudyID).To(Equal("s1"))
			Expect(result[0].Versions).To(HaveLen(1))
			Expect(result[0].Versions[0].HasSamples).To(BeTrue())

			Expect(result[1].StudyID).To(Equal("s2"))
			Expect(result[1].Versions).To(HaveLen(2))
			Expect(result[1].Versions[0].HasSamples).To(BeFalse())
			Expect(result[1].Versions[1].HasSamples).To(BeTrue())
		})

		It("returns an error when listing study directories fails", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 1},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.errs["/samples/MyStudy"] = fmt.Errorf("permission denied")

			_, err := svc.GetAvailability(studies, tr)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("permission denied"))
		})

		It("returns an error when listing checkpoint directories under a version fails", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 1},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.subdirs["/samples/MyStudy"] = []string{"v1"}
			fs.errs["/samples/MyStudy/v1"] = fmt.Errorf("I/O error")

			_, err := svc.GetAvailability(studies, tr)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("I/O error"))
		})

		It("returns empty result when no studies are provided", func() {
			tr := model.TrainingRun{
				Name:        "model",
				Checkpoints: []model.Checkpoint{{Filename: "cp1.safetensors"}},
			}

			result, err := svc.GetAvailability([]model.Study{}, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(BeEmpty())
		})

		It("marks has_samples=false for version with only non-matching checkpoint dirs", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy", Version: 1},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.subdirs["/samples/MyStudy"] = []string{"v1"}
			fs.subdirs["/samples/MyStudy/v1"] = []string{"other-checkpoint.safetensors", "random-dir"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result[0].Versions[0].HasSamples).To(BeFalse())
		})
	})
})
