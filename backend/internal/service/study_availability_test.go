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
		// Path pattern after B-078 restructure:
		// {sampleDir}/{SanitizeTrainingRunName(tr.Name)}/{study.ID}/
		// e.g. training run "model", study ID "s1" → /samples/model/s1

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

			// No subdirectories under /samples/model/s1
			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].StudyID).To(Equal("s1"))
			Expect(result[0].StudyName).To(Equal("MyStudy"))
			Expect(result[0].HasSamples).To(BeFalse())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusNone))
			Expect(result[0].CheckpointsWithSamples).To(Equal(0))
			Expect(result[0].TotalCheckpoints).To(Equal(1))
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

			// All checkpoint directories present under /samples/model/s1
			fs.subdirs["/samples/model/s1"] = []string{"cp1.safetensors", "cp2.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusComplete))
			Expect(result[0].CheckpointsWithSamples).To(Equal(2))
			Expect(result[0].TotalCheckpoints).To(Equal(2))
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

			// Only one of three checkpoints has a sample directory under /samples/model/s1
			fs.subdirs["/samples/model/s1"] = []string{"cp1.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusPartial))
			Expect(result[0].CheckpointsWithSamples).To(Equal(1))
			Expect(result[0].TotalCheckpoints).To(Equal(3))
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

			fs.subdirs["/samples/model/s1"] = []string{"other-checkpoint.safetensors", "random-dir"}

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

			// StudyA (s1): all checkpoints present (complete)
			fs.subdirs["/samples/model/s1"] = []string{"cp1.safetensors", "cp2.safetensors"}
			// StudyB (s2): only one checkpoint (partial)
			fs.subdirs["/samples/model/s2"] = []string{"cp1.safetensors"}
			// StudyC (s3): no matching checkpoints (none)
			fs.subdirs["/samples/model/s3"] = []string{"other-dir"}

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
			fs.subdirs["/samples/model/s1"] = []string{"cp1.safetensors"}

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

			fs.errs["/samples/model/s1"] = fmt.Errorf("permission denied")

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

		It("sanitizes training run name with slashes when constructing path", func() {
			studies := []model.Study{
				{ID: "s1", Name: "MyStudy"},
			}
			tr := model.TrainingRun{
				Name: "qwen/Qwen2-VL",
				Checkpoints: []model.Checkpoint{
					{Filename: "cp1.safetensors"},
				},
			}

			// Slashes in training run name are replaced with underscores
			fs.subdirs["/samples/qwen_Qwen2-VL/s1"] = []string{"cp1.safetensors"}

			result, err := svc.GetAvailability(studies, tr)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].HasSamples).To(BeTrue())
			Expect(result[0].SampleStatus).To(Equal(model.StudySampleStatusComplete))
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
