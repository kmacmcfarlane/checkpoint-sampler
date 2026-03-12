package store_test

import (
	"database/sql"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

var _ = Describe("FixtureSeeder", func() {
	var (
		s         *store.Store
		seeder    *store.FixtureSeeder
		tmpDir    string
		sampleDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "fixture-seeder-test-*")
		Expect(err).NotTo(HaveOccurred())

		sampleDir = filepath.Join(tmpDir, "samples")
		err = os.MkdirAll(sampleDir, 0755)
		Expect(err).NotTo(HaveOccurred())

		dbPath := filepath.Join(tmpDir, "test.db")
		db, err := store.OpenDB(dbPath)
		Expect(err).NotTo(HaveOccurred())

		logger := logrus.New()
		logger.SetOutput(io.Discard)

		s, err = store.New(db, logger)
		Expect(err).NotTo(HaveOccurred())

		seeder = store.NewFixtureSeeder(s, sampleDir, logger)
	})

	AfterEach(func() {
		if s != nil {
			s.Close()
		}
		os.RemoveAll(tmpDir)
	})

	Describe("SeedFixtures", func() {
		// AC: BE: FixtureSeeder.SeedFixtures() detects already-seeded data and skips re-seeding
		It("succeeds on a clean database", func() {
			err := seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Both fixture studies should exist in the database
			_, err = s.GetStudy(store.E2EFixtureStudyID)
			Expect(err).NotTo(HaveOccurred())

			_, err = s.GetStudy(store.E2ESlashFixtureStudyID)
			Expect(err).NotTo(HaveOccurred())
		})

		// AC: BE: FixtureSeeder.SeedFixtures() detects already-seeded data and skips re-seeding
		// AC: BE: Silent state duplication is prevented if the cleaner fails mid-reset
		It("is idempotent — double-calling does not fail or duplicate data", func() {
			// First call seeds the data
			err := seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Verify initial study count
			studies, err := s.ListStudies()
			Expect(err).NotTo(HaveOccurred())
			Expect(studies).To(HaveLen(2))

			// Second call should detect existing fixture data and skip re-seeding
			err = seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Study count must remain 2 — no duplicates
			studies, err = s.ListStudies()
			Expect(err).NotTo(HaveOccurred())
			Expect(studies).To(HaveLen(2))
		})

		It("preserves the fixture study data after seeding", func() {
			err := seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			study, err := s.GetStudy(store.E2EFixtureStudyID)
			Expect(err).NotTo(HaveOccurred())
			Expect(study.ID).To(Equal(store.E2EFixtureStudyID))
			Expect(study.Name).To(Equal(store.E2EFixtureStudyName))
		})

		It("preserves the slash fixture study data after seeding", func() {
			err := seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			study, err := s.GetStudy(store.E2ESlashFixtureStudyID)
			Expect(err).NotTo(HaveOccurred())
			Expect(study.ID).To(Equal(store.E2ESlashFixtureStudyID))
			Expect(study.Name).To(Equal(store.E2ESlashFixtureStudyName))
		})

		It("creates sample directories for fixture checkpoints", func() {
			err := seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Check that sample dirs were created for the fixture study
			for _, cpFilename := range []string{
				"my-model-step00001000.safetensors",
				"my-model-step00002000.safetensors",
			} {
				cpDir := filepath.Join(sampleDir, "my-model", store.E2EFixtureStudyID, cpFilename)
				_, err := os.Stat(cpDir)
				Expect(err).NotTo(HaveOccurred(), "expected checkpoint dir %s to exist", cpDir)
			}
		})

		// AC: BE: Silent state duplication is prevented if the cleaner fails mid-reset
		It("does not re-seed when called again after the first successful seed", func() {
			// First seed
			err := seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Confirm fixture study exists
			_, err = s.GetStudy(store.E2EFixtureStudyID)
			Expect(err).NotTo(HaveOccurred())

			// Second seed should be a no-op (idempotency guard triggers)
			err = seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Only the two original fixture studies should be present
			studies, err := s.ListStudies()
			Expect(err).NotTo(HaveOccurred())
			Expect(studies).To(HaveLen(2))
		})

		It("returns no error if fixture study is missing (clean DB path)", func() {
			// Verify clean DB has no studies
			studies, err := s.ListStudies()
			Expect(err).NotTo(HaveOccurred())
			Expect(studies).To(HaveLen(0))

			// Seeding on clean DB should succeed
			err = seeder.SeedFixtures()
			Expect(err).NotTo(HaveOccurred())

			// Verify the fixture study was created
			_, err = s.GetStudy(store.E2EFixtureStudyID)
			Expect(err).NotTo(HaveOccurred(), "fixture study should exist after seeding clean DB")
			Expect(err).NotTo(Equal(sql.ErrNoRows))
		})
	})
})
