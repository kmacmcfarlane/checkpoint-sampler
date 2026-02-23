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

var _ = Describe("SamplePreset Store", func() {
	var (
		s      *store.Store
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "sample-preset-test-*")
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
			original := model.SamplePreset{
				ID:   "test-id",
				Name: "Test Preset",
				Prompts: []model.NamedPrompt{
					{Name: "prompt1", Text: "text1"},
					{Name: "prompt2", Text: "text2"},
				},
				NegativePrompt: "negative test",
				Steps:          []int{1, 4, 8},
				CFGs:           []float64{1.0, 3.0, 7.0},
				Samplers:       []string{"euler", "heun"},
				Schedulers:     []string{"simple", "normal"},
				Seeds:          []int64{42, 420},
				Width:          1024,
				Height:         768,
				CreatedAt:      now,
				UpdatedAt:      now,
			}

			err := s.CreateSamplePreset(original)
			Expect(err).NotTo(HaveOccurred())

			retrieved, err := s.GetSamplePreset("test-id")
			Expect(err).NotTo(HaveOccurred())

			// Verify all fields match
			Expect(retrieved.ID).To(Equal(original.ID))
			Expect(retrieved.Name).To(Equal(original.Name))
			Expect(retrieved.Prompts).To(Equal(original.Prompts))
			Expect(retrieved.NegativePrompt).To(Equal(original.NegativePrompt))
			Expect(retrieved.Steps).To(Equal(original.Steps))
			Expect(retrieved.CFGs).To(Equal(original.CFGs))
			Expect(retrieved.Samplers).To(Equal(original.Samplers))
			Expect(retrieved.Schedulers).To(Equal(original.Schedulers))
			Expect(retrieved.Seeds).To(Equal(original.Seeds))
			Expect(retrieved.Width).To(Equal(original.Width))
			Expect(retrieved.Height).To(Equal(original.Height))
			Expect(retrieved.CreatedAt.Unix()).To(Equal(original.CreatedAt.Unix()))
			Expect(retrieved.UpdatedAt.Unix()).To(Equal(original.UpdatedAt.Unix()))
		})

		It("handles empty slices correctly", func() {
			now := time.Now().UTC().Truncate(time.Second)
			original := model.SamplePreset{
				ID:             "empty-arrays",
				Name:           "Empty Arrays",
				Prompts:        []model.NamedPrompt{{Name: "p1", Text: "t1"}},
				NegativePrompt: "",
				Steps:          []int{20},
				CFGs:           []float64{7.0},
				Samplers:       []string{"euler"},
				Schedulers:     []string{"simple"},
				Seeds:          []int64{42},
				Width:          512,
				Height:         512,
				CreatedAt:      now,
				UpdatedAt:      now,
			}

			err := s.CreateSamplePreset(original)
			Expect(err).NotTo(HaveOccurred())

			retrieved, err := s.GetSamplePreset("empty-arrays")
			Expect(err).NotTo(HaveOccurred())

			Expect(retrieved.Prompts).To(HaveLen(1))
			Expect(retrieved.Steps).To(Equal([]int{20}))
			Expect(retrieved.CFGs).To(Equal([]float64{7.0}))
		})
	})

	Describe("CRUD operations", func() {
		var samplePreset model.SamplePreset

		BeforeEach(func() {
			now := time.Now().UTC().Truncate(time.Second)
			samplePreset = model.SamplePreset{
				ID:   "preset-1",
				Name: "Sample Preset",
				Prompts: []model.NamedPrompt{
					{Name: "test", Text: "test prompt"},
				},
				NegativePrompt: "negative",
				Steps:          []int{4, 8},
				CFGs:           []float64{1.0, 7.0},
				Samplers:       []string{"euler"},
				Schedulers:     []string{"simple"},
				Seeds:          []int64{420},
				Width:          512,
				Height:         512,
				CreatedAt:      now,
				UpdatedAt:      now,
			}
		})

		Describe("CreateSamplePreset", func() {
			It("creates a new sample preset", func() {
				err := s.CreateSamplePreset(samplePreset)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetSamplePreset(samplePreset.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.ID).To(Equal(samplePreset.ID))
				Expect(retrieved.Name).To(Equal(samplePreset.Name))
			})

			It("rejects duplicate ID", func() {
				err := s.CreateSamplePreset(samplePreset)
				Expect(err).NotTo(HaveOccurred())

				// Try to create again with same ID
				err = s.CreateSamplePreset(samplePreset)
				Expect(err).To(HaveOccurred())
			})
		})

		Describe("ListSamplePresets", func() {
			It("returns empty slice when no presets exist", func() {
				result, err := s.ListSamplePresets()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(0))
			})

			It("returns all sample presets ordered by name", func() {
				preset1 := samplePreset
				preset1.ID = "id-1"
				preset1.Name = "Zebra"

				preset2 := samplePreset
				preset2.ID = "id-2"
				preset2.Name = "Apple"

				err := s.CreateSamplePreset(preset1)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSamplePreset(preset2)
				Expect(err).NotTo(HaveOccurred())

				result, err := s.ListSamplePresets()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(2))
				// Should be ordered by name: Apple, Zebra
				Expect(result[0].Name).To(Equal("Apple"))
				Expect(result[1].Name).To(Equal("Zebra"))
			})
		})

		Describe("GetSamplePreset", func() {
			BeforeEach(func() {
				err := s.CreateSamplePreset(samplePreset)
				Expect(err).NotTo(HaveOccurred())
			})

			It("retrieves a sample preset by ID", func() {
				result, err := s.GetSamplePreset(samplePreset.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(result.ID).To(Equal(samplePreset.ID))
				Expect(result.Name).To(Equal(samplePreset.Name))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				_, err := s.GetSamplePreset("nonexistent")
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})

		Describe("UpdateSamplePreset", func() {
			BeforeEach(func() {
				err := s.CreateSamplePreset(samplePreset)
				Expect(err).NotTo(HaveOccurred())
			})

			It("updates an existing sample preset", func() {
				updated := samplePreset
				updated.Name = "Updated Name"
				updated.Width = 1024
				updated.Height = 1024
				updated.UpdatedAt = time.Now().UTC()

				err := s.UpdateSamplePreset(updated)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetSamplePreset(updated.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.Name).To(Equal("Updated Name"))
				Expect(retrieved.Width).To(Equal(1024))
				Expect(retrieved.Height).To(Equal(1024))
				// CreatedAt should remain unchanged
				Expect(retrieved.CreatedAt.Unix()).To(Equal(samplePreset.CreatedAt.Unix()))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				nonExistent := samplePreset
				nonExistent.ID = "nonexistent"
				err := s.UpdateSamplePreset(nonExistent)
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})

		Describe("DeleteSamplePreset", func() {
			BeforeEach(func() {
				err := s.CreateSamplePreset(samplePreset)
				Expect(err).NotTo(HaveOccurred())
			})

			It("deletes an existing sample preset", func() {
				err := s.DeleteSamplePreset(samplePreset.ID)
				Expect(err).NotTo(HaveOccurred())

				// Verify it's gone
				_, err = s.GetSamplePreset(samplePreset.ID)
				Expect(err).To(Equal(sql.ErrNoRows))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				err := s.DeleteSamplePreset("nonexistent")
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})
	})
})
