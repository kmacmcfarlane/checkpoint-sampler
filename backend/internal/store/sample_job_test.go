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

var _ = Describe("SampleJob Store", func() {
	var (
		s      *store.Store
		tmpDir string
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "sample-job-test-*")
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

	// Helper to create a sample preset (required for foreign key constraint)
	createSamplePreset := func(id string) {
		now := time.Now().UTC().Truncate(time.Second)
		preset := model.SamplePreset{
			ID:   id,
			Name: "Test Preset",
			Prompts: []model.NamedPrompt{
				{Name: "test", Text: "test prompt"},
			},
			NegativePrompt: "negative",
			Steps:          []int{4},
			CFGs:           []float64{7.0},
			Samplers:       []string{"euler"},
			Schedulers:     []string{"simple"},
			Seeds:          []int64{42},
			Width:          512,
			Height:         512,
			CreatedAt:      now,
			UpdatedAt:      now,
		}
		err := s.CreateSamplePreset(preset)
		Expect(err).NotTo(HaveOccurred())
	}

	Describe("SampleJob CRUD operations", func() {
		var sampleJob model.SampleJob

		BeforeEach(func() {
			// Create prerequisite sample preset
			createSamplePreset("preset-1")

			now := time.Now().UTC().Truncate(time.Second)
			shift := 1.5
			sampleJob = model.SampleJob{
				ID:              "job-1",
				TrainingRunName: "test-run",
				SamplePresetID:  "preset-1",
				WorkflowName:    "flux-dev",
				VAE:             "vae-model",
				CLIP:            "clip-model",
				Shift:           &shift,
				Status:          model.SampleJobStatusPending,
				TotalItems:      10,
				CompletedItems:  0,
				ErrorMessage:    "",
				CreatedAt:       now,
				UpdatedAt:       now,
			}
		})

		Describe("CreateSampleJob", func() {
			It("creates a new sample job with all fields", func() {
				err := s.CreateSampleJob(sampleJob)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetSampleJob(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.ID).To(Equal(sampleJob.ID))
				Expect(retrieved.TrainingRunName).To(Equal(sampleJob.TrainingRunName))
				Expect(retrieved.SamplePresetID).To(Equal(sampleJob.SamplePresetID))
				Expect(retrieved.WorkflowName).To(Equal(sampleJob.WorkflowName))
				Expect(retrieved.VAE).To(Equal(sampleJob.VAE))
				Expect(retrieved.CLIP).To(Equal(sampleJob.CLIP))
				Expect(retrieved.Shift).NotTo(BeNil())
				Expect(*retrieved.Shift).To(Equal(*sampleJob.Shift))
				Expect(retrieved.Status).To(Equal(sampleJob.Status))
				Expect(retrieved.TotalItems).To(Equal(sampleJob.TotalItems))
				Expect(retrieved.CompletedItems).To(Equal(sampleJob.CompletedItems))
				Expect(retrieved.ErrorMessage).To(Equal(sampleJob.ErrorMessage))
				Expect(retrieved.CreatedAt.Unix()).To(Equal(sampleJob.CreatedAt.Unix()))
				Expect(retrieved.UpdatedAt.Unix()).To(Equal(sampleJob.UpdatedAt.Unix()))
			})

			It("creates a sample job with nullable fields empty", func() {
				now := time.Now().UTC().Truncate(time.Second)
				job := model.SampleJob{
					ID:              "job-nullable",
					TrainingRunName: "test-run",
					SamplePresetID:  "preset-1",
					WorkflowName:    "flux-dev",
					VAE:             "",
					CLIP:            "",
					Shift:           nil,
					Status:          model.SampleJobStatusPending,
					TotalItems:      5,
					CompletedItems:  0,
					ErrorMessage:    "",
					CreatedAt:       now,
					UpdatedAt:       now,
				}

				err := s.CreateSampleJob(job)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetSampleJob(job.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.VAE).To(Equal(""))
				Expect(retrieved.CLIP).To(Equal(""))
				Expect(retrieved.Shift).To(BeNil())
				Expect(retrieved.ErrorMessage).To(Equal(""))
			})

			It("rejects duplicate ID", func() {
				err := s.CreateSampleJob(sampleJob)
				Expect(err).NotTo(HaveOccurred())

				// Try to create again with same ID
				err = s.CreateSampleJob(sampleJob)
				Expect(err).To(HaveOccurred())
			})

			It("enforces foreign key constraint on sample_preset_id", func() {
				now := time.Now().UTC().Truncate(time.Second)
				jobWithInvalidPreset := model.SampleJob{
					ID:              "job-invalid-fk",
					TrainingRunName: "test-run",
					SamplePresetID:  "nonexistent-preset",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      5,
					CompletedItems:  0,
					CreatedAt:       now,
					UpdatedAt:       now,
				}

				err := s.CreateSampleJob(jobWithInvalidPreset)
				Expect(err).To(HaveOccurred())
			})
		})

		Describe("ListSampleJobs", func() {
			It("returns empty slice when no jobs exist", func() {
				result, err := s.ListSampleJobs()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(0))
			})

			It("returns all sample jobs ordered by created_at descending", func() {
				now := time.Now().UTC().Truncate(time.Second)

				job1 := sampleJob
				job1.ID = "job-1"
				job1.CreatedAt = now.Add(-2 * time.Hour)
				job1.UpdatedAt = now.Add(-2 * time.Hour)

				job2 := sampleJob
				job2.ID = "job-2"
				job2.CreatedAt = now.Add(-1 * time.Hour)
				job2.UpdatedAt = now.Add(-1 * time.Hour)

				job3 := sampleJob
				job3.ID = "job-3"
				job3.CreatedAt = now
				job3.UpdatedAt = now

				err := s.CreateSampleJob(job1)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSampleJob(job2)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSampleJob(job3)
				Expect(err).NotTo(HaveOccurred())

				result, err := s.ListSampleJobs()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(3))
				// Should be ordered by created_at DESC: job3, job2, job1
				Expect(result[0].ID).To(Equal("job-3"))
				Expect(result[1].ID).To(Equal("job-2"))
				Expect(result[2].ID).To(Equal("job-1"))
			})
		})

		Describe("GetSampleJob", func() {
			BeforeEach(func() {
				err := s.CreateSampleJob(sampleJob)
				Expect(err).NotTo(HaveOccurred())
			})

			It("retrieves a sample job by ID", func() {
				result, err := s.GetSampleJob(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(result.ID).To(Equal(sampleJob.ID))
				Expect(result.TrainingRunName).To(Equal(sampleJob.TrainingRunName))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				_, err := s.GetSampleJob("nonexistent")
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})

		Describe("UpdateSampleJob", func() {
			BeforeEach(func() {
				err := s.CreateSampleJob(sampleJob)
				Expect(err).NotTo(HaveOccurred())
			})

			It("updates an existing sample job", func() {
				updated := sampleJob
				updated.Status = model.SampleJobStatusRunning
				updated.CompletedItems = 5
				updated.UpdatedAt = time.Now().UTC()

				err := s.UpdateSampleJob(updated)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetSampleJob(updated.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.Status).To(Equal(model.SampleJobStatusRunning))
				Expect(retrieved.CompletedItems).To(Equal(5))
				// CreatedAt should remain unchanged
				Expect(retrieved.CreatedAt.Unix()).To(Equal(sampleJob.CreatedAt.Unix()))
			})

			It("updates nullable fields to non-empty values", func() {
				updated := sampleJob
				updated.ErrorMessage = "test error"
				updated.UpdatedAt = time.Now().UTC()

				err := s.UpdateSampleJob(updated)
				Expect(err).NotTo(HaveOccurred())

				retrieved, err := s.GetSampleJob(updated.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(retrieved.ErrorMessage).To(Equal("test error"))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				nonExistent := sampleJob
				nonExistent.ID = "nonexistent"
				err := s.UpdateSampleJob(nonExistent)
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})

		Describe("DeleteSampleJob", func() {
			BeforeEach(func() {
				err := s.CreateSampleJob(sampleJob)
				Expect(err).NotTo(HaveOccurred())
			})

			It("deletes an existing sample job", func() {
				err := s.DeleteSampleJob(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())

				// Verify it's gone
				_, err = s.GetSampleJob(sampleJob.ID)
				Expect(err).To(Equal(sql.ErrNoRows))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				err := s.DeleteSampleJob("nonexistent")
				Expect(err).To(Equal(sql.ErrNoRows))
			})

			It("cascades delete to sample job items", func() {
				// Create a job item
				now := time.Now().UTC().Truncate(time.Second)
				item := model.SampleJobItem{
					ID:                 "item-1",
					JobID:              sampleJob.ID,
					CheckpointFilename: "checkpoint-001.safetensors",
					ComfyUIModelPath:   "/models/checkpoint-001.safetensors",
					PromptName:         "test",
					PromptText:         "test prompt",
					Steps:              4,
					CFG:                7.0,
					SamplerName:        "euler",
					Scheduler:          "simple",
					Seed:               42,
					Status:             model.SampleJobItemStatusPending,
					CreatedAt:          now,
					UpdatedAt:          now,
				}
				err := s.CreateSampleJobItem(item)
				Expect(err).NotTo(HaveOccurred())

				// Delete the parent job
				err = s.DeleteSampleJob(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())

				// Verify the job item is also deleted
				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(0))
			})
		})
	})

	Describe("SampleJobItem CRUD operations", func() {
		var sampleJob model.SampleJob
		var sampleJobItem model.SampleJobItem

		BeforeEach(func() {
			// Create prerequisite sample preset and job
			createSamplePreset("preset-1")

			now := time.Now().UTC().Truncate(time.Second)
			sampleJob = model.SampleJob{
				ID:              "job-1",
				TrainingRunName: "test-run",
				SamplePresetID:  "preset-1",
				WorkflowName:    "flux-dev",
				Status:          model.SampleJobStatusPending,
				TotalItems:      10,
				CompletedItems:  0,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			err := s.CreateSampleJob(sampleJob)
			Expect(err).NotTo(HaveOccurred())

			sampleJobItem = model.SampleJobItem{
				ID:                 "item-1",
				JobID:              sampleJob.ID,
				CheckpointFilename: "checkpoint-001.safetensors",
				ComfyUIModelPath:   "/models/checkpoint-001.safetensors",
				PromptName:         "test",
				PromptText:         "test prompt",
				Steps:              4,
				CFG:                7.0,
				SamplerName:        "euler",
				Scheduler:          "simple",
				Seed:               42,
				Status:             model.SampleJobItemStatusPending,
				ComfyUIPromptID:    "",
				OutputPath:         "",
				ErrorMessage:       "",
				CreatedAt:          now,
				UpdatedAt:          now,
			}
		})

		Describe("CreateSampleJobItem", func() {
			It("creates a new sample job item with all fields", func() {
				err := s.CreateSampleJobItem(sampleJobItem)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].ID).To(Equal(sampleJobItem.ID))
				Expect(items[0].JobID).To(Equal(sampleJobItem.JobID))
				Expect(items[0].CheckpointFilename).To(Equal(sampleJobItem.CheckpointFilename))
				Expect(items[0].ComfyUIModelPath).To(Equal(sampleJobItem.ComfyUIModelPath))
				Expect(items[0].PromptName).To(Equal(sampleJobItem.PromptName))
				Expect(items[0].PromptText).To(Equal(sampleJobItem.PromptText))
				Expect(items[0].Steps).To(Equal(sampleJobItem.Steps))
				Expect(items[0].CFG).To(Equal(sampleJobItem.CFG))
				Expect(items[0].SamplerName).To(Equal(sampleJobItem.SamplerName))
				Expect(items[0].Scheduler).To(Equal(sampleJobItem.Scheduler))
				Expect(items[0].Seed).To(Equal(sampleJobItem.Seed))
				Expect(items[0].Status).To(Equal(sampleJobItem.Status))
				Expect(items[0].ComfyUIPromptID).To(Equal(""))
				Expect(items[0].OutputPath).To(Equal(""))
				Expect(items[0].ErrorMessage).To(Equal(""))
			})

			It("creates a sample job item with nullable fields populated", func() {
				now := time.Now().UTC().Truncate(time.Second)
				itemWithOptionals := model.SampleJobItem{
					ID:                 "item-2",
					JobID:              sampleJob.ID,
					CheckpointFilename: "checkpoint-002.safetensors",
					ComfyUIModelPath:   "/models/checkpoint-002.safetensors",
					PromptName:         "test",
					PromptText:         "test prompt",
					Steps:              8,
					CFG:                7.5,
					SamplerName:        "euler",
					Scheduler:          "simple",
					Seed:               420,
					Status:             model.SampleJobItemStatusCompleted,
					ComfyUIPromptID:    "prompt-123",
					OutputPath:         "/outputs/image.png",
					ErrorMessage:       "",
					CreatedAt:          now,
					UpdatedAt:          now,
				}

				err := s.CreateSampleJobItem(itemWithOptionals)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].ComfyUIPromptID).To(Equal("prompt-123"))
				Expect(items[0].OutputPath).To(Equal("/outputs/image.png"))
			})

			It("enforces foreign key constraint on job_id", func() {
				now := time.Now().UTC().Truncate(time.Second)
				itemWithInvalidJob := model.SampleJobItem{
					ID:                 "item-invalid-fk",
					JobID:              "nonexistent-job",
					CheckpointFilename: "checkpoint.safetensors",
					ComfyUIModelPath:   "/models/checkpoint.safetensors",
					PromptName:         "test",
					PromptText:         "test prompt",
					Steps:              4,
					CFG:                7.0,
					SamplerName:        "euler",
					Scheduler:          "simple",
					Seed:               42,
					Status:             model.SampleJobItemStatusPending,
					CreatedAt:          now,
					UpdatedAt:          now,
				}

				err := s.CreateSampleJobItem(itemWithInvalidJob)
				Expect(err).To(HaveOccurred())
			})
		})

		Describe("ListSampleJobItems", func() {
			It("returns empty slice when no items exist for job", func() {
				result, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(0))
			})

			It("returns all items for a job ordered by created_at", func() {
				now := time.Now().UTC().Truncate(time.Second)

				item1 := sampleJobItem
				item1.ID = "item-1"
				item1.CreatedAt = now.Add(-2 * time.Minute)
				item1.UpdatedAt = now.Add(-2 * time.Minute)

				item2 := sampleJobItem
				item2.ID = "item-2"
				item2.CreatedAt = now.Add(-1 * time.Minute)
				item2.UpdatedAt = now.Add(-1 * time.Minute)

				item3 := sampleJobItem
				item3.ID = "item-3"
				item3.CreatedAt = now
				item3.UpdatedAt = now

				err := s.CreateSampleJobItem(item1)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSampleJobItem(item2)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSampleJobItem(item3)
				Expect(err).NotTo(HaveOccurred())

				result, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(3))
				// Should be ordered by created_at ASC: item1, item2, item3
				Expect(result[0].ID).To(Equal("item-1"))
				Expect(result[1].ID).To(Equal("item-2"))
				Expect(result[2].ID).To(Equal("item-3"))
			})

			It("returns only items for the specified job", func() {
				// Create another job
				now := time.Now().UTC().Truncate(time.Second)
				job2 := model.SampleJob{
					ID:              "job-2",
					TrainingRunName: "test-run-2",
					SamplePresetID:  "preset-1",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      5,
					CompletedItems:  0,
					CreatedAt:       now,
					UpdatedAt:       now,
				}
				err := s.CreateSampleJob(job2)
				Expect(err).NotTo(HaveOccurred())

				// Create items for job-1
				item1 := sampleJobItem
				item1.ID = "item-1"
				item1.JobID = "job-1"
				err = s.CreateSampleJobItem(item1)
				Expect(err).NotTo(HaveOccurred())

				// Create items for job-2
				item2 := sampleJobItem
				item2.ID = "item-2"
				item2.JobID = "job-2"
				err = s.CreateSampleJobItem(item2)
				Expect(err).NotTo(HaveOccurred())

				// List items for job-1 should only return item-1
				result, err := s.ListSampleJobItems("job-1")
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(1))
				Expect(result[0].ID).To(Equal("item-1"))
			})
		})

		Describe("UpdateSampleJobItem", func() {
			BeforeEach(func() {
				err := s.CreateSampleJobItem(sampleJobItem)
				Expect(err).NotTo(HaveOccurred())
			})

			It("updates an existing sample job item", func() {
				updated := sampleJobItem
				updated.Status = model.SampleJobItemStatusCompleted
				updated.ComfyUIPromptID = "prompt-456"
				updated.OutputPath = "/outputs/result.png"
				updated.UpdatedAt = time.Now().UTC()

				err := s.UpdateSampleJobItem(updated)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))
				Expect(items[0].ComfyUIPromptID).To(Equal("prompt-456"))
				Expect(items[0].OutputPath).To(Equal("/outputs/result.png"))
				// CreatedAt should remain unchanged
				Expect(items[0].CreatedAt.Unix()).To(Equal(sampleJobItem.CreatedAt.Unix()))
			})

			It("updates nullable fields", func() {
				updated := sampleJobItem
				updated.ErrorMessage = "test error"
				updated.UpdatedAt = time.Now().UTC()

				err := s.UpdateSampleJobItem(updated)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].ErrorMessage).To(Equal("test error"))
			})

			It("returns sql.ErrNoRows for non-existent ID", func() {
				nonExistent := sampleJobItem
				nonExistent.ID = "nonexistent"
				err := s.UpdateSampleJobItem(nonExistent)
				Expect(err).To(Equal(sql.ErrNoRows))
			})
		})
	})
})
