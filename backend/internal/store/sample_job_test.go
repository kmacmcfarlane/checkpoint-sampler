package store_test

import (
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
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

	// Helper to create a study (required for foreign key constraint)
	createStudy := func(id string) {
		now := time.Now().UTC().Truncate(time.Second)
		study := model.Study{
			ID:   id,
			Name: "Test Study",
			Prompts: []model.NamedPrompt{
				{Name: "test", Text: "test prompt"},
			},
			NegativePrompt: "negative",
			Steps:          []int{4},
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
		err := s.CreateStudy(study)
		Expect(err).NotTo(HaveOccurred())
	}

	Describe("SampleJob CRUD operations", func() {
		var sampleJob model.SampleJob

		BeforeEach(func() {
			// Create prerequisite study
			createStudy("study-1")

			now := time.Now().UTC().Truncate(time.Second)
			shift := 1.5
			sampleJob = model.SampleJob{
				ID:              "job-1",
				TrainingRunName: "test-run",
				StudyID:         "study-1",
				StudyName:       "Test Study",
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
				Expect(retrieved.StudyID).To(Equal(sampleJob.StudyID))
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
					StudyID:         "study-1",
					StudyName:       "Test Study",
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

			It("enforces foreign key constraint on study_id", func() {
				now := time.Now().UTC().Truncate(time.Second)
				jobWithInvalidStudy := model.SampleJob{
					ID:              "job-invalid-fk",
					TrainingRunName: "test-run",
					StudyID:         "nonexistent-study",
					StudyName:       "Nonexistent",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      5,
					CompletedItems:  0,
					CreatedAt:       now,
					UpdatedAt:       now,
				}

				err := s.CreateSampleJob(jobWithInvalidStudy)
				Expect(err).To(HaveOccurred())
			})
		})

		Describe("ListSampleJobs", func() {
			It("returns empty slice when no jobs exist", func() {
				result, err := s.ListSampleJobs()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(0))
			})

			It("returns all sample jobs ordered by created_at ascending (FIFO)", func() {
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
				// Should be ordered by created_at ASC (oldest first): job1, job2, job3
				Expect(result[0].ID).To(Equal("job-1"))
				Expect(result[1].ID).To(Equal("job-2"))
				Expect(result[2].ID).To(Equal("job-3"))
			})

			It("returns pending jobs in FIFO order for deterministic pickup", func() {
				now := time.Now().UTC().Truncate(time.Second)

				// Create three pending jobs with distinct creation times
				pendingJob1 := sampleJob
				pendingJob1.ID = "pending-job-1"
				pendingJob1.Status = model.SampleJobStatusPending
				pendingJob1.CreatedAt = now.Add(-3 * time.Hour)
				pendingJob1.UpdatedAt = now.Add(-3 * time.Hour)

				pendingJob2 := sampleJob
				pendingJob2.ID = "pending-job-2"
				pendingJob2.Status = model.SampleJobStatusPending
				pendingJob2.CreatedAt = now.Add(-2 * time.Hour)
				pendingJob2.UpdatedAt = now.Add(-2 * time.Hour)

				pendingJob3 := sampleJob
				pendingJob3.ID = "pending-job-3"
				pendingJob3.Status = model.SampleJobStatusPending
				pendingJob3.CreatedAt = now.Add(-1 * time.Hour)
				pendingJob3.UpdatedAt = now.Add(-1 * time.Hour)

				// Insert in non-chronological order to verify ordering is from query, not insertion
				err := s.CreateSampleJob(pendingJob3)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSampleJob(pendingJob1)
				Expect(err).NotTo(HaveOccurred())

				err = s.CreateSampleJob(pendingJob2)
				Expect(err).NotTo(HaveOccurred())

				result, err := s.ListSampleJobs()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(3))

				// All jobs should be pending and returned in creation order (oldest first = FIFO)
				Expect(result[0].ID).To(Equal("pending-job-1"))
				Expect(result[0].Status).To(Equal(model.SampleJobStatusPending))
				Expect(result[1].ID).To(Equal("pending-job-2"))
				Expect(result[1].Status).To(Equal(model.SampleJobStatusPending))
				Expect(result[2].ID).To(Equal("pending-job-3"))
				Expect(result[2].Status).To(Equal(model.SampleJobStatusPending))
			})
		})

		Describe("ListSampleJobsDesc", func() {
			It("returns empty slice when no jobs exist", func() {
				result, err := s.ListSampleJobsDesc()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(0))
			})

			It("returns all sample jobs ordered by created_at descending (newest first)", func() {
				now := time.Now().UTC().Truncate(time.Second)

				job1 := model.SampleJob{
					ID:              "job-desc-1",
					TrainingRunName: "test-run",
					StudyID:         "study-1",
					StudyName:       "Test Study",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      1,
					CompletedItems:  0,
					CreatedAt:       now.Add(-2 * time.Hour),
					UpdatedAt:       now.Add(-2 * time.Hour),
				}
				job2 := model.SampleJob{
					ID:              "job-desc-2",
					TrainingRunName: "test-run",
					StudyID:         "study-1",
					StudyName:       "Test Study",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      1,
					CompletedItems:  0,
					CreatedAt:       now.Add(-1 * time.Hour),
					UpdatedAt:       now.Add(-1 * time.Hour),
				}
				job3 := model.SampleJob{
					ID:              "job-desc-3",
					TrainingRunName: "test-run",
					StudyID:         "study-1",
					StudyName:       "Test Study",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      1,
					CompletedItems:  0,
					CreatedAt:       now,
					UpdatedAt:       now,
				}

				// Insert oldest first
				Expect(s.CreateSampleJob(job1)).To(Succeed())
				Expect(s.CreateSampleJob(job2)).To(Succeed())
				Expect(s.CreateSampleJob(job3)).To(Succeed())

				result, err := s.ListSampleJobsDesc()
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(3))
				// Should be ordered newest-first: job3, job2, job1
				Expect(result[0].ID).To(Equal("job-desc-3"))
				Expect(result[1].ID).To(Equal("job-desc-2"))
				Expect(result[2].ID).To(Equal("job-desc-1"))
			})

			It("returns jobs in opposite order to ListSampleJobs", func() {
				now := time.Now().UTC().Truncate(time.Second)

				jobA := model.SampleJob{
					ID:              "job-order-a",
					TrainingRunName: "test-run",
					StudyID:         "study-1",
					StudyName:       "Test Study",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      1,
					CompletedItems:  0,
					CreatedAt:       now.Add(-1 * time.Hour),
					UpdatedAt:       now.Add(-1 * time.Hour),
				}
				jobB := model.SampleJob{
					ID:              "job-order-b",
					TrainingRunName: "test-run",
					StudyID:         "study-1",
					StudyName:       "Test Study",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusPending,
					TotalItems:      1,
					CompletedItems:  0,
					CreatedAt:       now,
					UpdatedAt:       now,
				}

				Expect(s.CreateSampleJob(jobA)).To(Succeed())
				Expect(s.CreateSampleJob(jobB)).To(Succeed())

				asc, err := s.ListSampleJobs()
				Expect(err).NotTo(HaveOccurred())
				Expect(asc).To(HaveLen(2))
				Expect(asc[0].ID).To(Equal("job-order-a")) // oldest first (FIFO for executor)

				desc, err := s.ListSampleJobsDesc()
				Expect(err).NotTo(HaveOccurred())
				Expect(desc).To(HaveLen(2))
				Expect(desc[0].ID).To(Equal("job-order-b")) // newest first (for UI display)
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

	Describe("CheckpointFilenames persistence", func() {
		BeforeEach(func() {
			createStudy("study-1")
		})

		It("persists and retrieves checkpoint_filenames field", func() {
			now := time.Now().UTC().Truncate(time.Second)
			job := model.SampleJob{
				ID:                  "job-ckpt-filenames",
				TrainingRunName:     "test-run",
				StudyID:             "study-1",
				StudyName:           "Test Study",
				WorkflowName:        "flux-dev",
				Status:              model.SampleJobStatusPending,
				CheckpointFilenames: []string{"ckpt-step00001000.safetensors", "ckpt-step00002000.safetensors"},
				TotalItems:          10,
				CompletedItems:      0,
				CreatedAt:           now,
				UpdatedAt:           now,
			}
			err := s.CreateSampleJob(job)
			Expect(err).NotTo(HaveOccurred())

			retrieved, err := s.GetSampleJob(job.ID)
			Expect(err).NotTo(HaveOccurred())
			Expect(retrieved.CheckpointFilenames).To(ConsistOf("ckpt-step00001000.safetensors", "ckpt-step00002000.safetensors"))
		})

		It("stores empty slice when checkpoint_filenames is nil", func() {
			now := time.Now().UTC().Truncate(time.Second)
			job := model.SampleJob{
				ID:                  "job-ckpt-nil",
				TrainingRunName:     "test-run",
				StudyID:             "study-1",
				StudyName:           "Test Study",
				WorkflowName:        "flux-dev",
				Status:              model.SampleJobStatusPending,
				CheckpointFilenames: nil,
				TotalItems:          5,
				CompletedItems:      0,
				CreatedAt:           now,
				UpdatedAt:           now,
			}
			err := s.CreateSampleJob(job)
			Expect(err).NotTo(HaveOccurred())

			retrieved, err := s.GetSampleJob(job.ID)
			Expect(err).NotTo(HaveOccurred())
			Expect(retrieved.CheckpointFilenames).To(BeEmpty())
		})

		It("persists checkpoint_filenames via ListSampleJobs", func() {
			now := time.Now().UTC().Truncate(time.Second)
			job := model.SampleJob{
				ID:                  "job-ckpt-list",
				TrainingRunName:     "test-run",
				StudyID:             "study-1",
				StudyName:           "Test Study",
				WorkflowName:        "flux-dev",
				Status:              model.SampleJobStatusPending,
				CheckpointFilenames: []string{"model-step00004500.safetensors"},
				TotalItems:          8,
				CompletedItems:      0,
				CreatedAt:           now,
				UpdatedAt:           now,
			}
			err := s.CreateSampleJob(job)
			Expect(err).NotTo(HaveOccurred())

			jobs, err := s.ListSampleJobs()
			Expect(err).NotTo(HaveOccurred())
			Expect(jobs).To(HaveLen(1))
			Expect(jobs[0].CheckpointFilenames).To(ConsistOf("model-step00004500.safetensors"))
		})
	})

	Describe("SampleJobItem CRUD operations", func() {
		var sampleJob model.SampleJob
		var sampleJobItem model.SampleJobItem

		BeforeEach(func() {
			// Create prerequisite study and job
			createStudy("study-1")

			now := time.Now().UTC().Truncate(time.Second)
			sampleJob = model.SampleJob{
				ID:              "job-1",
				TrainingRunName: "test-run",
				StudyID:         "study-1",
				StudyName:       "Test Study",
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
				Width:              512,
				Height:             512,
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

			It("persists explicit width and height values", func() {
				now := time.Now().UTC().Truncate(time.Second)
				itemWithExplicitSize := model.SampleJobItem{
					ID:                 "item-explicit-size",
					JobID:              sampleJob.ID,
					CheckpointFilename: "checkpoint-003.safetensors",
					ComfyUIModelPath:   "/models/checkpoint-003.safetensors",
					PromptName:         "test",
					PromptText:         "test prompt",
					Steps:              4,
					CFG:                7.0,
					SamplerName:        "euler",
					Scheduler:          "simple",
					Seed:               42,
					Width:              1024,
					Height:             768,
					Status:             model.SampleJobItemStatusPending,
					CreatedAt:          now,
					UpdatedAt:          now,
				}

				err := s.CreateSampleJobItem(itemWithExplicitSize)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].Width).To(Equal(1024))
				Expect(items[0].Height).To(Equal(768))
			})

			It("persists zero width and height values as-is", func() {
				now := time.Now().UTC().Truncate(time.Second)
				itemWithZeroSize := model.SampleJobItem{
					ID:                 "item-zero-size",
					JobID:              sampleJob.ID,
					CheckpointFilename: "checkpoint-004.safetensors",
					ComfyUIModelPath:   "/models/checkpoint-004.safetensors",
					PromptName:         "test",
					PromptText:         "test prompt",
					Steps:              4,
					CFG:                7.0,
					SamplerName:        "euler",
					Scheduler:          "simple",
					Seed:               42,
					Width:              0,
					Height:             0,
					Status:             model.SampleJobItemStatusPending,
					CreatedAt:          now,
					UpdatedAt:          now,
				}

				err := s.CreateSampleJobItem(itemWithZeroSize)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				// Zero values are stored as-is (migration only applies to existing rows)
				Expect(items[0].Width).To(Equal(0))
				Expect(items[0].Height).To(Equal(0))
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
					StudyID:         "study-1",
					StudyName:       "Test Study",
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

		Describe("NegativePrompt persistence", func() {
			It("persists and retrieves negative_prompt field", func() {
				now := time.Now().UTC().Truncate(time.Second)
				item := model.SampleJobItem{
					ID:                 "item-neg-prompt",
					JobID:              sampleJob.ID,
					CheckpointFilename: "checkpoint.safetensors",
					ComfyUIModelPath:   "/models/checkpoint.safetensors",
					PromptName:         "test",
					PromptText:         "a beautiful landscape",
					NegativePrompt:     "blurry, artifacts, bad quality",
					Steps:              20,
					CFG:                7.0,
					SamplerName:        "euler",
					Scheduler:          "normal",
					Seed:               42,
					Width:              512,
					Height:             512,
					Status:             model.SampleJobItemStatusPending,
					CreatedAt:          now,
					UpdatedAt:          now,
				}

				err := s.CreateSampleJobItem(item)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].NegativePrompt).To(Equal("blurry, artifacts, bad quality"))
			})

			It("stores empty string when negative_prompt is not set", func() {
				err := s.CreateSampleJobItem(sampleJobItem)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].NegativePrompt).To(Equal(""))
			})

			It("updates negative_prompt on existing item", func() {
				err := s.CreateSampleJobItem(sampleJobItem)
				Expect(err).NotTo(HaveOccurred())

				updated := sampleJobItem
				updated.NegativePrompt = "low quality, blurry"
				updated.UpdatedAt = time.Now().UTC()

				err = s.UpdateSampleJobItem(updated)
				Expect(err).NotTo(HaveOccurred())

				items, err := s.ListSampleJobItems(sampleJob.ID)
				Expect(err).NotTo(HaveOccurred())
				Expect(items).To(HaveLen(1))
				Expect(items[0].NegativePrompt).To(Equal("low quality, blurry"))
			})
		})
	})

	// B-147: Sample job + items creation must be atomic. The job row and all of
	// its item rows are inserted in a single transaction so that a failure during
	// item insertion leaves no job row and no item rows behind.
	Describe("CreateSampleJobWithItems (atomic job + items)", func() {
		var (
			now   time.Time
			job   model.SampleJob
			items []model.SampleJobItem
		)

		// makeItem builds a fully-populated item belonging to job-atomic.
		makeItem := func(id, checkpoint string) model.SampleJobItem {
			return model.SampleJobItem{
				ID:                 id,
				JobID:              "job-atomic",
				CheckpointFilename: checkpoint,
				ComfyUIModelPath:   "/models/" + checkpoint,
				PromptName:         "test",
				PromptText:         "test prompt",
				Steps:              4,
				CFG:                7.0,
				SamplerName:        "euler",
				Scheduler:          "simple",
				Seed:               42,
				Width:              512,
				Height:             512,
				Status:             model.SampleJobItemStatusPending,
				CreatedAt:          now,
				UpdatedAt:          now,
			}
		}

		BeforeEach(func() {
			createStudy("study-atomic")
			now = time.Now().UTC().Truncate(time.Second)
			job = model.SampleJob{
				ID:              "job-atomic",
				TrainingRunName: "atomic-run",
				StudyID:         "study-atomic",
				StudyName:       "Test Study",
				WorkflowName:    "flux-dev",
				Status:          model.SampleJobStatusPending,
				CompletedItems:  0,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			items = []model.SampleJobItem{
				makeItem("item-a1", "checkpoint-a.safetensors"),
				makeItem("item-a2", "checkpoint-a.safetensors"),
				makeItem("item-b1", "checkpoint-b.safetensors"),
			}
		})

		It("persists the job and total_items == COUNT(sample_job_items WHERE job_id) on the happy path", func() {
			job.TotalItems = len(items)
			err := s.CreateSampleJobWithItems(job, items)
			Expect(err).NotTo(HaveOccurred())

			// The job row exists.
			stored, err := s.GetSampleJob("job-atomic")
			Expect(err).NotTo(HaveOccurred())
			Expect(stored.TotalItems).To(Equal(len(items)))

			// total_items must equal the actual number of item rows for the job.
			var itemCount int
			err = s.DB().QueryRow(
				"SELECT COUNT(*) FROM sample_job_items WHERE job_id = ?", "job-atomic",
			).Scan(&itemCount)
			Expect(err).NotTo(HaveOccurred())
			Expect(stored.TotalItems).To(Equal(itemCount))

			storedItems, err := s.ListSampleJobItems("job-atomic")
			Expect(err).NotTo(HaveOccurred())
			Expect(storedItems).To(HaveLen(len(items)))
		})

		It("rolls back entirely when an item insertion fails partway through (no job row, no item rows)", func() {
			// Inject a failure partway through item insertion by duplicating an item
			// ID. The third item reuses item-a1's primary key, so its INSERT fails
			// with a UNIQUE constraint violation after the first two items have been
			// inserted within the transaction.
			job.TotalItems = len(items)
			badItems := []model.SampleJobItem{
				makeItem("item-a1", "checkpoint-a.safetensors"),
				makeItem("item-a2", "checkpoint-a.safetensors"),
				makeItem("item-a1", "checkpoint-b.safetensors"), // duplicate PK -> fails mid-loop
			}

			err := s.CreateSampleJobWithItems(job, badItems)
			Expect(err).To(HaveOccurred())

			// The whole transaction must roll back: no job row.
			var jobCount int
			err = s.DB().QueryRow(
				"SELECT COUNT(*) FROM sample_jobs WHERE id = ?", "job-atomic",
			).Scan(&jobCount)
			Expect(err).NotTo(HaveOccurred())
			Expect(jobCount).To(Equal(0))

			// And no item rows.
			var itemCount int
			err = s.DB().QueryRow(
				"SELECT COUNT(*) FROM sample_job_items WHERE job_id = ?", "job-atomic",
			).Scan(&itemCount)
			Expect(err).NotTo(HaveOccurred())
			Expect(itemCount).To(Equal(0))
		})

		It("rolls back the job row when item insertion fails on an invalid foreign-key job_id", func() {
			// An item whose job_id does not reference the job being inserted (and
			// does not exist) violates the FK constraint, forcing a rollback. The
			// job row inserted earlier in the same transaction must not persist.
			job.TotalItems = 2
			badItems := []model.SampleJobItem{
				makeItem("item-ok", "checkpoint-a.safetensors"),
				func() model.SampleJobItem {
					it := makeItem("item-bad-fk", "checkpoint-b.safetensors")
					it.JobID = "nonexistent-job"
					return it
				}(),
			}

			err := s.CreateSampleJobWithItems(job, badItems)
			Expect(err).To(HaveOccurred())

			var jobCount int
			err = s.DB().QueryRow(
				"SELECT COUNT(*) FROM sample_jobs WHERE id = ?", "job-atomic",
			).Scan(&jobCount)
			Expect(err).NotTo(HaveOccurred())
			Expect(jobCount).To(Equal(0))

			var itemCount int
			err = s.DB().QueryRow(
				"SELECT COUNT(*) FROM sample_job_items WHERE job_id IN (?, ?)",
				"job-atomic", "nonexistent-job",
			).Scan(&itemCount)
			Expect(err).NotTo(HaveOccurred())
			Expect(itemCount).To(Equal(0))
		})
	})

	Describe("RecalculateCompletedItems (atomic derived counter)", func() {
		// makeRecalcItem builds an item belonging to job-recalc with the given status.
		makeRecalcItem := func(id string, status model.SampleJobItemStatus) model.SampleJobItem {
			now := time.Now().UTC().Truncate(time.Second)
			return model.SampleJobItem{
				ID:                 id,
				JobID:              "job-recalc",
				CheckpointFilename: "checkpoint-a.safetensors",
				ComfyUIModelPath:   "/models/checkpoint-a.safetensors",
				PromptName:         "test",
				PromptText:         "test prompt",
				Steps:              4,
				CFG:                7.0,
				SamplerName:        "euler",
				Scheduler:          "simple",
				Seed:               42,
				Width:              512,
				Height:             512,
				Status:             status,
				CreatedAt:          now,
				UpdatedAt:          now,
			}
		}

		BeforeEach(func() {
			createStudy("study-recalc")
			now := time.Now().UTC().Truncate(time.Second)
			job := model.SampleJob{
				ID:              "job-recalc",
				TrainingRunName: "recalc-run",
				StudyID:         "study-recalc",
				StudyName:       "Test Study",
				WorkflowName:    "flux-dev",
				Status:          model.SampleJobStatusRunning,
				TotalItems:      0,
				// Seed an intentionally stale/incorrect stored counter to prove the
				// recompute overwrites it with the authoritative item count.
				CompletedItems: 999,
				CreatedAt:      now,
				UpdatedAt:      now,
			}
			err := s.CreateSampleJob(job)
			Expect(err).NotTo(HaveOccurred())
		})

		It("derives completed_items from the count of completed items, overwriting a stale stored counter", func() {
			// 3 completed, 1 failed, 1 pending => completed_items must become exactly 3.
			Expect(s.CreateSampleJobItem(makeRecalcItem("c1", model.SampleJobItemStatusCompleted))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeRecalcItem("c2", model.SampleJobItemStatusCompleted))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeRecalcItem("c3", model.SampleJobItemStatusCompleted))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeRecalcItem("f1", model.SampleJobItemStatusFailed))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeRecalcItem("p1", model.SampleJobItemStatusPending))).To(Succeed())

			completed, err := s.RecalculateCompletedItems("job-recalc")
			Expect(err).NotTo(HaveOccurred())
			Expect(completed).To(Equal(3))

			// The persisted row must match the returned value (no drift).
			stored, err := s.GetSampleJob("job-recalc")
			Expect(err).NotTo(HaveOccurred())
			Expect(stored.CompletedItems).To(Equal(3))
		})

		It("returns sql.ErrNoRows for a job that does not exist", func() {
			_, err := s.RecalculateCompletedItems("missing-job")
			Expect(err).To(MatchError(sql.ErrNoRows))
		})

		It("never loses updates under concurrent completions: final counter equals completed item count exactly", func() {
			// Insert N pending items, then flip each to completed concurrently and call
			// RecalculateCompletedItems after each flip from its own goroutine. Because
			// the counter is derived in a single UPDATE (and the pool is single-writer),
			// the final stored value must equal N exactly — no lost updates.
			const n = 50
			for i := 0; i < n; i++ {
				Expect(s.CreateSampleJobItem(makeRecalcItem(fmt.Sprintf("item-%d", i), model.SampleJobItemStatusPending))).To(Succeed())
			}

			var wg sync.WaitGroup
			wg.Add(n)
			for i := 0; i < n; i++ {
				go func(idx int) {
					defer wg.Done()
					item := makeRecalcItem(fmt.Sprintf("item-%d", idx), model.SampleJobItemStatusCompleted)
					if err := s.UpdateSampleJobItem(item); err != nil {
						return
					}
					_, _ = s.RecalculateCompletedItems("job-recalc")
				}(i)
			}
			wg.Wait()

			// One final authoritative recompute, then assert exact equality.
			completed, err := s.RecalculateCompletedItems("job-recalc")
			Expect(err).NotTo(HaveOccurred())
			Expect(completed).To(Equal(n))

			stored, err := s.GetSampleJob("job-recalc")
			Expect(err).NotTo(HaveOccurred())
			Expect(stored.CompletedItems).To(Equal(n))

			var actualCompleted int
			err = s.DB().QueryRow(
				"SELECT COUNT(*) FROM sample_job_items WHERE job_id = ? AND status = ?",
				"job-recalc", string(model.SampleJobItemStatusCompleted),
			).Scan(&actualCompleted)
			Expect(err).NotTo(HaveOccurred())
			Expect(stored.CompletedItems).To(Equal(actualCompleted))
		})
	})

	Describe("ListJobsProgress (aggregate, no full item-row loading)", func() {
		// makeAggItem builds an item for a given job/checkpoint/status. error
		// fields are optional and only set for failed items.
		makeAggItem := func(id, jobID, checkpoint string, status model.SampleJobItemStatus, errMsg string) model.SampleJobItem {
			now := time.Now().UTC().Truncate(time.Second)
			return model.SampleJobItem{
				ID:                 id,
				JobID:              jobID,
				CheckpointFilename: checkpoint,
				ComfyUIModelPath:   "/models/" + checkpoint,
				PromptName:         "test",
				PromptText:         "test prompt",
				Steps:              4,
				CFG:                7.0,
				SamplerName:        "euler",
				Scheduler:          "simple",
				Seed:               42,
				Width:              512,
				Height:             512,
				Status:             status,
				ErrorMessage:       errMsg,
				CreatedAt:          now,
				UpdatedAt:          now,
			}
		}

		BeforeEach(func() {
			createStudy("study-agg")
			now := time.Now().UTC().Truncate(time.Second)
			for _, jobID := range []string{"job-a", "job-b", "job-empty"} {
				job := model.SampleJob{
					ID:              jobID,
					TrainingRunName: "agg-run",
					StudyID:         "study-agg",
					StudyName:       "Test Study",
					WorkflowName:    "flux-dev",
					Status:          model.SampleJobStatusRunning,
					TotalItems:      0,
					CompletedItems:  0,
					CreatedAt:       now,
					UpdatedAt:       now,
				}
				Expect(s.CreateSampleJob(job)).To(Succeed())
			}
		})

		It("returns aggregate counts matching a mixed-status fixture and matches per-job ListSampleJobItems-derived counts", func() {
			// job-a: 3 completed, 1 failed, 1 skipped, 2 pending
			//        => Completed 3, Failed 2 (failed+skipped), Pending 2.
			Expect(s.CreateSampleJobItem(makeAggItem("a-c1", "job-a", "chk1.safetensors", model.SampleJobItemStatusCompleted, ""))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("a-c2", "job-a", "chk1.safetensors", model.SampleJobItemStatusCompleted, ""))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("a-c3", "job-a", "chk2.safetensors", model.SampleJobItemStatusCompleted, ""))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("a-f1", "job-a", "chk2.safetensors", model.SampleJobItemStatusFailed, "boom"))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("a-s1", "job-a", "chk3.safetensors", model.SampleJobItemStatusSkipped, "checkpoint not found"))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("a-p1", "job-a", "chk3.safetensors", model.SampleJobItemStatusPending, ""))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("a-p2", "job-a", "chk3.safetensors", model.SampleJobItemStatusPending, ""))).To(Succeed())

			// job-b: 1 completed only.
			Expect(s.CreateSampleJobItem(makeAggItem("b-c1", "job-b", "chk1.safetensors", model.SampleJobItemStatusCompleted, ""))).To(Succeed())

			progress, err := s.ListJobsProgress()
			Expect(err).NotTo(HaveOccurred())

			Expect(progress["job-a"].ItemCounts.Completed).To(Equal(3))
			Expect(progress["job-a"].ItemCounts.Failed).To(Equal(2)) // failed + skipped
			Expect(progress["job-a"].ItemCounts.Pending).To(Equal(2))

			Expect(progress["job-b"].ItemCounts.Completed).To(Equal(1))
			Expect(progress["job-b"].ItemCounts.Failed).To(Equal(0))
			Expect(progress["job-b"].ItemCounts.Pending).To(Equal(0))

			// job-empty has no items: it is absent from the map (zero value).
			_, present := progress["job-empty"]
			Expect(present).To(BeFalse())

			// Parity cross-check: aggregate counts equal counts derived by iterating
			// the full item rows (the path GetProgress/Show uses).
			items, err := s.ListSampleJobItems("job-a")
			Expect(err).NotTo(HaveOccurred())
			var c, f, p int
			for _, it := range items {
				switch it.Status {
				case model.SampleJobItemStatusCompleted:
					c++
				case model.SampleJobItemStatusFailed, model.SampleJobItemStatusSkipped:
					f++
				case model.SampleJobItemStatusPending:
					p++
				}
			}
			Expect(progress["job-a"].ItemCounts.Completed).To(Equal(c))
			Expect(progress["job-a"].ItemCounts.Failed).To(Equal(f))
			Expect(progress["job-a"].ItemCounts.Pending).To(Equal(p))
		})

		It("reconstructs per-checkpoint failed item details (deduped by message, sorted by checkpoint)", func() {
			// chk2 has two distinct failure messages; chk1 has a duplicate message
			// (must dedupe to one detail); chk3 has a failed item with no message
			// (must yield an 'unknown error' detail).
			Expect(s.CreateSampleJobItem(makeAggItem("d-1", "job-a", "chk1.safetensors", model.SampleJobItemStatusFailed, "same error"))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("d-2", "job-a", "chk1.safetensors", model.SampleJobItemStatusFailed, "same error"))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("d-3", "job-a", "chk2.safetensors", model.SampleJobItemStatusFailed, "error one"))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("d-4", "job-a", "chk2.safetensors", model.SampleJobItemStatusFailed, "error two"))).To(Succeed())
			Expect(s.CreateSampleJobItem(makeAggItem("d-5", "job-a", "chk3.safetensors", model.SampleJobItemStatusFailed, ""))).To(Succeed())

			progress, err := s.ListJobsProgress()
			Expect(err).NotTo(HaveOccurred())

			details := progress["job-a"].FailedItemDetails
			// 1 (chk1 deduped) + 2 (chk2) + 1 (chk3 unknown) = 4.
			Expect(details).To(HaveLen(4))

			// Group by checkpoint for assertions.
			byCheckpoint := map[string][]string{}
			for _, d := range details {
				byCheckpoint[d.CheckpointFilename] = append(byCheckpoint[d.CheckpointFilename], d.ErrorMessage)
			}
			Expect(byCheckpoint["chk1.safetensors"]).To(ConsistOf("same error"))
			Expect(byCheckpoint["chk2.safetensors"]).To(ConsistOf("error one", "error two"))
			Expect(byCheckpoint["chk3.safetensors"]).To(ConsistOf("unknown error"))
		})

		It("returns an empty map when there are no items at all", func() {
			progress, err := s.ListJobsProgress()
			Expect(err).NotTo(HaveOccurred())
			Expect(progress).To(BeEmpty())
		})
	})
})
