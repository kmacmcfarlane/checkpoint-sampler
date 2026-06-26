package store_test

import (
	"database/sql"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

// Coverage for two previously-untested store queries used in
// study-uniqueness (GetStudyByName) and job-gating (HasRunningJob) flows.
var _ = Describe("Store uncovered queries", func() {
	var (
		s      *store.Store
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "store-queries-test-*")
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		logger := logrus.New()
		logger.SetOutput(io.Discard)
		s, err = store.New(db, logger)
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		if s != nil {
			s.Close()
		}
		os.RemoveAll(tmpDir)
	})

	newStudy := func(id, name string) model.Study {
		now := time.Now().UTC().Truncate(time.Second)
		return model.Study{
			ID:                    id,
			Name:                  name,
			Prompts:               []model.NamedPrompt{{Name: "p", Text: "t"}},
			NegativePrompt:        "neg",
			Steps:                 []int{4},
			CFGs:                  []float64{7.0},
			SamplerSchedulerPairs: []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "simple"}},
			Seeds:                 []int64{42},
			Width:                 512,
			Height:                512,
			CreatedAt:             now,
			UpdatedAt:             now,
		}
	}

	Describe("GetStudyByName", func() {
		// AC: found
		It("returns the study when one matches the name", func() {
			Expect(s.CreateStudy(newStudy("study-1", "Alpha"))).To(Succeed())

			got, err := s.GetStudyByName("Alpha", "")
			Expect(err).NotTo(HaveOccurred())
			Expect(got.ID).To(Equal("study-1"))
			Expect(got.Name).To(Equal("Alpha"))
		})

		// AC: not-found
		It("returns sql.ErrNoRows when no study matches the name", func() {
			Expect(s.CreateStudy(newStudy("study-1", "Alpha"))).To(Succeed())

			_, err := s.GetStudyByName("Beta", "")
			Expect(errors.Is(err, sql.ErrNoRows)).To(BeTrue())
		})

		// AC: multiple/uniqueness — studies.name carries a UNIQUE constraint, so two
		// studies cannot share a name. This pins that invariant (a CreateStudy with a
		// duplicate name fails), which is precisely why GetStudyByName is used as the
		// pre-insert uniqueness guard rather than relying on duplicates existing.
		It("cannot create two studies with the same name (UNIQUE constraint)", func() {
			Expect(s.CreateStudy(newStudy("study-1", "Dup"))).To(Succeed())
			err := s.CreateStudy(newStudy("study-2", "Dup"))
			Expect(err).To(HaveOccurred())

			// Only the first study exists, and GetStudyByName finds exactly it.
			got, err := s.GetStudyByName("Dup", "")
			Expect(err).NotTo(HaveOccurred())
			Expect(got.ID).To(Equal("study-1"))
		})

		// AC: excludeID — the named study matching excludeID is skipped, which is
		// how the uniqueness check ignores the study being updated (so re-saving a
		// study without changing its name does not flag a false collision).
		It("excludes the study with the given excludeID", func() {
			Expect(s.CreateStudy(newStudy("study-1", "Alpha"))).To(Succeed())

			// Only study-1 has the name; excluding it yields no rows.
			_, err := s.GetStudyByName("Alpha", "study-1")
			Expect(errors.Is(err, sql.ErrNoRows)).To(BeTrue())
		})

		// AC: excludeID — a different study that genuinely collides on the name is
		// still found when some unrelated ID is excluded.
		It("still finds the colliding study when an unrelated ID is excluded", func() {
			Expect(s.CreateStudy(newStudy("study-1", "Alpha"))).To(Succeed())

			got, err := s.GetStudyByName("Alpha", "some-other-id")
			Expect(err).NotTo(HaveOccurred())
			Expect(got.ID).To(Equal("study-1"))
		})
	})

	Describe("HasRunningJob", func() {
		createStudy := func(id string) {
			Expect(s.CreateStudy(newStudy(id, "Study "+id))).To(Succeed())
		}
		newJob := func(id, studyID string, status model.SampleJobStatus) model.SampleJob {
			now := time.Now().UTC().Truncate(time.Second)
			return model.SampleJob{
				ID:              id,
				TrainingRunName: "run",
				StudyID:         studyID,
				StudyName:       "Study " + studyID,
				WorkflowName:    "flux-dev",
				Status:          status,
				TotalItems:      1,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
		}

		// AC: not-found — no jobs at all.
		It("returns false when there are no jobs", func() {
			running, err := s.HasRunningJob()
			Expect(err).NotTo(HaveOccurred())
			Expect(running).To(BeFalse())
		})

		// AC: not-found — jobs exist but none are running.
		It("returns false when jobs exist but none are running", func() {
			createStudy("study-1")
			Expect(s.CreateSampleJob(newJob("job-1", "study-1", model.SampleJobStatusPending))).To(Succeed())
			Expect(s.CreateSampleJob(newJob("job-2", "study-1", model.SampleJobStatusCompleted))).To(Succeed())

			running, err := s.HasRunningJob()
			Expect(err).NotTo(HaveOccurred())
			Expect(running).To(BeFalse())
		})

		// AC: found — at least one running job.
		It("returns true when at least one job is running", func() {
			createStudy("study-1")
			Expect(s.CreateSampleJob(newJob("job-1", "study-1", model.SampleJobStatusPending))).To(Succeed())
			Expect(s.CreateSampleJob(newJob("job-2", "study-1", model.SampleJobStatusRunning))).To(Succeed())

			running, err := s.HasRunningJob()
			Expect(err).NotTo(HaveOccurred())
			Expect(running).To(BeTrue())
		})

		// AC: multiple — more than one running job still returns true.
		It("returns true when multiple jobs are running", func() {
			createStudy("study-1")
			Expect(s.CreateSampleJob(newJob("job-1", "study-1", model.SampleJobStatusRunning))).To(Succeed())
			Expect(s.CreateSampleJob(newJob("job-2", "study-1", model.SampleJobStatusRunning))).To(Succeed())

			running, err := s.HasRunningJob()
			Expect(err).NotTo(HaveOccurred())
			Expect(running).To(BeTrue())
		})
	})
})
