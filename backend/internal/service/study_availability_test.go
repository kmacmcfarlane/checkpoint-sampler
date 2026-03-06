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
	subdirs  map[string][]string
	dirExist map[string]bool
	errs     map[string]error
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

	Describe("GetAvailability", func() {
		It("returns has_samples=false and status=none when no checkpoint directories exist under study", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
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
			Expect(result[0].HasSamples).To(BeFalse())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusNone))
		})

		It("marks has_samples=true and status=complete when all checkpoint dirs match", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
					{Filename: "cp2.safetensors"},
				},
			}

			// All checkpoint directories present under /samples/MyStudy
			fs.subdirs["/samples/MyStudy"] = []string{"cp1.safetensors", "cp2.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusComplete))
		})

		It("marks has_samples=true and status=partial when only some checkpoint dirs match", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
					{Filename: "cp2.safetensors"},
					{Filename: "cp3.safetensors"},
				},
			}

			// Only one of three checkpoints has a sample directory
			fs.subdirs["/samples/MyStudy"] = []string{"cp1.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusPartial))
		})

		It("marks has_samples=false and status=none when only non-matching checkpoint dirs exist", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			fs.subdirs["/samples/MyStudy"] = []string{"other-checkpoint.safetensors", "random-dir"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result[0].HasSamples).To(BeFalse())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusNone))
		})

		It("handles multiple studies with different statuses", func() {
			studies := []model.Study{
				{ID: "s1", Name: "StudyA"},
				{ID: "s2", Name: "StudyB"},
				{ID: "s3", Name: "StudyC"},
			}
			tr := model.TrainingRun{
				Name: "model",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
					{Filename: "cp2.safetensors"},
				},
			}

			// StudyA: all checkpoints present (complete)
			fs.subdirs["/samples/StudyA"] = []string{"cp1.safetensors", "cp2.safetensors"}
			// StudyB: only one checkpoint (partial)
			fs.subdirs["/samples/StudyB"] = []string{"cp1.safetensors"}
			// StudyC: no matching checkpoints (none)
			fs.subdirs["/samples/StudyC"] = []string{"other-dir"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(3))

			Expect(result[0].StudyID).To(Equal("s1"))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusComplete))

			Expect(result[1].StudyID).To(Equal("s2"))
			Expect(result[1].HasSamples).To(BeTrue())
			Expect(result[1].SampleStatus).To(Equal(model.StudySampleStatusPartial))

			Expect(result[2].StudyID).To(Equal("s3"))
			Expect(result[2].HasSamples).To(BeFalse())
			Expect(result[2].SampleStatus).To(Equal(model.StudySampleStatusNone))
		})

		It("returns status=none when training run has zero checkpoints", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
			}
			tr := model.TrainingRun{
				Name:        "model",
				Checkpoints: []model.Checkpoint{},
			}

			// Even if there are directories, zero checkpoints means no matches possible
			fs.subdirs["/samples/MyStudy"] = []string{"cp1.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].HasSamples).To(BeFalse())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusNone))
		})

		It("returns an error when listing study directories fails", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
			}
			tr := model.TrainingRun{
				Name:        "model",
				Checkpoints: []model.Checkpoint{{Filename: "cp1.safetensors"}},
			}

			fs.errs["/samples/MyStudy"] = fmt.Errorf("permission denied")

			_, err := svc.GetAvailability(studies, tr)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("permission denied"))
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
	})

	Describe("StudyHasSamples", func() {
		It("returns false when study directory does not exist", func() {
			study := model.Study{ID: "s1", Name: "NoDir"}
			// DirectoryExists returns false by default

			hasSamples, err := svc.StudyHasSamples(study)
			Expect(err).NotTo(HaveOccurred())
			Expect(hasSamples).To(BeFalse())
		})

		It("returns false when study directory exists but is empty", func() {
			study := model.Study{ID: "s1", Name: "EmptyStudy"}
			fs.dirExist["/samples/EmptyStudy"] = true
			fs.subdirs["/samples/EmptyStudy"] = []string{}

			hasSamples, err := svc.StudyHasSamples(study)
			Expect(err).NotTo(HaveOccurred())
			Expect(hasSamples).To(BeFalse())
		})

		It("returns true when study directory has subdirectories", func() {
			study := model.Study{ID: "s1", Name: "WithSamples"}
			fs.dirExist["/samples/WithSamples"] = true
			fs.subdirs["/samples/WithSamples"] = []string{"checkpoint1.safetensors"}

			hasSamples, err := svc.StudyHasSamples(study)
			Expect(err).NotTo(HaveOccurred())
			Expect(hasSamples).To(BeTrue())
		})

		It("returns error when listing directory fails", func() {
			study := model.Study{ID: "s1", Name: "ErrorStudy"}
			fs.dirExist["/samples/ErrorStudy"] = true
			fs.errs["/samples/ErrorStudy"] = fmt.Errorf("I/O error")

			_, err := svc.StudyHasSamples(study)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("I/O error"))
		})
	})
})
