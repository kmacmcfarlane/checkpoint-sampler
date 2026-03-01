package store_test

import (
	"database/sql"
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

var _ = Describe("Study Store", func() {
	var (
		s      *store.Store
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "study-test-*")
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

	Describe("JSON marshaling/unmarshaling round-trips", func() {
		It("preserves all fields through entity conversion", func() {
			now := time.Now().UTC().Truncate(time.Second)
			original := model.Study{
				ID:   "test-id",
				Name: "Test Study",
				Prompts: []model.NamedPrompt{
					{Name: "prompt1", Text: "text1"},
					{Name: "prompt2", Text: "text2"},
				},
				NegativePrompt: "negative test",
				Steps:          []int{1, 4, 8},
				CFGs:           []float64{1.0, 3.0, 7.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
					{Sampler: "heun", Scheduler: "normal"},
				},
				Seeds:     []int64{42, 420},
				Width:     1024,
				Height:    768,
				CreatedAt: now,
				UpdatedAt: now,
			}

			err := s.CreateStudy(original)
			Expect(err).NotTo(HaveOccurred())

			retrieved, err := s.GetStudy("test-id")
			Expect(err).NotTo(HaveOccurred())

			// Verify all fields match
			Expect(retrieved.ID).To(Equal(original.ID))
			Expect(retrieved.Name).To(Equal(original.Name))
			Expect(retrieved.Prompts).To(Equal(original.Prompts))
			Expect(retrieved.NegativePrompt).To(Equal(original.NegativePrompt))
			Expect(retrieved.Steps).To(Equal(original.Steps))
			Expect(retrieved.CFGs).To(Equal(original.CFGs))
			Expect(retrieved.SamplerSchedulerPairs).To(Equal(original.SamplerSchedulerPairs))
			Expect(retrieved.Seeds).To(Equal(original.Seeds))
			Expect(retrieved.Width).To(Equal(original.Width))
			Expect(retrieved.Height).To(Equal(original.Height))
			Expect(retrieved.CreatedAt.Unix()).To(Equal(original.CreatedAt.Unix()))
			Expect(retrieved.UpdatedAt.Unix()).To(Equal(original.UpdatedAt.Unix()))
		})

		It("handles single pair correctly", func() {
			now := time.Now().UTC().Truncate(time.Second)
			original := model.Study{
				ID:             "single-pair",
				Name:           "Single Pair",
				Prompts:        []model.NamedPrompt{{Name: "p1", Text: "t1"}},
				NegativePrompt: "",
				Steps:          []int{20},
				CFGs:           []float64{7.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
				},
				Seeds:     []int64{42},
				Width:     512,
				Height:    512,
				CreatedAt: now,
				UpdatedAt: now,
			}

			err := s.CreateStudy(original)
			Expect(err).NotTo(HaveOccurred())

			retrieved, err := s.GetStudy("single-pair")
			Expect(err).NotTo(HaveOccurred())

			Expect(retrieved.SamplerSchedulerPairs).To(HaveLen(1))
			Expect(retrieved.SamplerSchedulerPairs[0].Sampler).To(Equal("euler"))
			Expect(retrieved.SamplerSchedulerPairs[0].Scheduler).To(Equal("simple"))
		})
	})

	Describe("Migration: cross-product conversion of existing presets", func() {
		It("converts independent samplers and schedulers to cross-product pairs during migration", func() {
			// Create a database with old schema (migrations 1-7 only)
			tmpDirMigration, err := os.MkdirTemp("", "migration-test-*")
			Expect(err).NotTo(HaveOccurred())
			defer os.RemoveAll(tmpDirMigration)

			dbPath := filepath.Join(tmpDirMigration, "test.db")
			db, err := store.OpenDB(dbPath)
			Expect(err).NotTo(HaveOccurred())

			// Apply only first 7 migrations (old schema with separate samplers/schedulers)
			allMigrations := store.AllMigrations()
			oldMigrations := allMigrations[:7]
			err = store.Migrate(db, oldMigrations)
			Expect(err).NotTo(HaveOccurred())

			// Insert a preset using the old schema
			_, err = db.Exec(`INSERT INTO sample_presets
				(id, name, prompts, negative_prompt, steps, cfgs, samplers, schedulers, seeds, width, height, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				"migration-test-id",
				"Migration Test",
				`[{"name":"p1","text":"t1"}]`,
				"negative",
				`[4,8]`,
				`[1.0,3.0]`,
				`["euler","dpmpp_2m"]`,
				`["simple","sgm_uniform"]`,
				`[42]`,
				512, 512,
				"2025-01-01T00:00:00Z",
				"2025-01-01T00:00:00Z",
			)
			Expect(err).NotTo(HaveOccurred())

			// Now apply all migrations (including migration 8 and 10 which renames to studies)
			err = store.Migrate(db, allMigrations)
			Expect(err).NotTo(HaveOccurred())

			// Create a store to read the migrated data
			logger := logrus.New()
			logger.SetOutput(io.Discard)
			migratedStore, err := store.New(db, logger)
			Expect(err).NotTo(HaveOccurred())
			defer migratedStore.Close()

			// Read the migrated study (was preset)
			study, err := migratedStore.GetStudy("migration-test-id")
			Expect(err).NotTo(HaveOccurred())

			// Verify cross-product: 2 samplers x 2 schedulers = 4 pairs
			Expect(study.SamplerSchedulerPairs).To(HaveLen(4))

			// Build a map for deterministic assertion
			pairSet := make(map[string]bool)
			for _, pair := range study.SamplerSchedulerPairs {
				pairSet[pair.Sampler+"+"+pair.Scheduler] = true
			}
			Expect(pairSet).To(HaveKey("euler+simple"))
			Expect(pairSet).To(HaveKey("euler+sgm_uniform"))
			Expect(pairSet).To(HaveKey("dpmpp_2m+simple"))
			Expect(pairSet).To(HaveKey("dpmpp_2m+sgm_uniform"))

			// Verify other fields are preserved
			Expect(study.Name).To(Equal("Migration Test"))
			Expect(study.Steps).To(Equal([]int{4, 8}))
			Expect(study.CFGs).To(Equal([]float64{1.0, 3.0}))
		})
	})

	Describe("CRUD operations", func() {
		var study model.Study

		BeforeEach(func() {
			now := time.Now().UTC().Truncate(time.Second)
			study = model.Study{
				ID:   "study-1",
				Name: "Test Study",
				Prompts: []model.NamedPrompt{
					{Name: "test", Text: "test prompt"},
				},
				NegativePrompt: "negative",
				Steps:          []int{4, 8},
				CFGs:           []float64{1.0, 7.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "simple"},
				},
				Seeds:     []int64{420},
				Width:     512,
				Height:    512,
				CreatedAt: now,
				UpdatedAt: now,
			}
		})

		Describe("CreateStudy", func() {
			It("creates a new study", func() {
				err := s.CreateStudy(study)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetStudy(study.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.ID).To(Equal(study.ID))
				Expect(retrieved.Name).To(Equal(study.Name))
			})

			It("rejects duplicate ID", func() {
				err := s.CreateStudy(study)
				Expect(err).NotTo(HaveOccurred())

				// Try to create again with same ID
				err = s.CreateStudy(study)
				Expect(err).To(HaveOccurred())
			})
		})

		Describe("ListStudies", func() {
			It("returns empty slice when no studies exist", func() {
				result, err := s.ListStudies()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(0))
			})

			It("returns all studies ordered by name", func() {
				study1 := study
				study1.ID = "id-1"
				study1.Name = "Zebra"

				study2 := study
				study2.ID = "id-2"
				study2.Name = "Apple"

				err := s.CreateStudy(study1)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateStudy(study2)
				Expect(err).NotTo(HaveOccurred())

				result, err := s.ListStudies()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(2))
				// Should be ordered by name: Apple, Zebra
				Expect(result[0].Name).To(Equal("Apple"))
				Expect(result[1].Name).To(Equal("Zebra"))
			})
		})

		Describe("GetStudy", func() {
			BeforeEach(func() {
				err := s.CreateStudy(study)
				Expect(err).NotTo(HaveOccurred())
			})

			It("retrieves a study by ID", func() {
				result, err := s.GetStudy(study.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(result.ID).To(Equal(study.ID))
				Expect(result.Name).To(Equal(study.Name))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				_, err := s.GetStudy("nonexistent")
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})

		Describe("UpdateStudy", func() {
			BeforeEach(func() {
				err := s.CreateStudy(study)
				Expect(err).NotTo(HaveOccurred())
			})

			It("updates an existing study", func() {
				updated := study
				updated.Name = "Updated Name"
				updated.Width = 1024
				updated.Height = 1024
				updated.SamplerSchedulerPairs = []model.SamplerSchedulerPair{
					{Sampler: "dpmpp_2m", Scheduler: "sgm_uniform"},
				}
				updated.UpdatedAt = time.Now().UTC()

				err := s.UpdateStudy(updated)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetStudy(updated.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.Name).To(Equal("Updated Name"))
				Expect(retrieved.Width).To(Equal(1024))
				Expect(retrieved.Height).To(Equal(1024))
				Expect(retrieved.SamplerSchedulerPairs).To(HaveLen(1))
				Expect(retrieved.SamplerSchedulerPairs[0].Sampler).To(Equal("dpmpp_2m"))
				Expect(retrieved.SamplerSchedulerPairs[0].Scheduler).To(Equal("sgm_uniform"))
				// CreatedAt should remain unchanged
				Expect(retrieved.CreatedAt.Unix()).To(Equal(study.CreatedAt.Unix()))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				nonExistent := study
				nonExistent.ID = "nonexistent"
				err := s.UpdateStudy(nonExistent)
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})

		Describe("DeleteStudy", func() {
			BeforeEach(func() {
				err := s.CreateStudy(study)
				Expect(err).NotTo(HaveOccurred())
			})

			It("deletes an existing study", func() {
				err := s.DeleteStudy(study.ID)
				Expect(err).NotTo(HaveOccurred())

				// Verify it's gone
				_, err = s.GetStudy(study.ID)
				Expect(err).To(Equal(sql.ErrNoRows))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				err := s.DeleteStudy("nonexistent")
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})
	})
})
