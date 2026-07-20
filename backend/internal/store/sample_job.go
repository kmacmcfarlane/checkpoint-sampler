package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// sampleJobEntity is the persistence representation of a sample job.
type sampleJobEntity struct {
	ID                  string
	TrainingRunName     string
	StudyID             string
	StudyName           string
	WorkflowName        string
	VAE                 sql.NullString
	CLIP                sql.NullString
	Shift               sql.NullFloat64
	BaseModel           string
	CheckpointFilenames string // JSON-encoded []string
	ClearExisting       bool
	Status              string
	TotalItems          int
	CompletedItems      int
	ErrorMessage        sql.NullString
	CreatedAt           string // RFC3339
	UpdatedAt           string // RFC3339
}

// sampleJobItemEntity is the persistence representation of a sample job item.
type sampleJobItemEntity struct {
	ID                 string
	JobID              string
	CheckpointFilename string
	ComfyUIModelPath   string
	LoraModelPath      string
	StrengthModel      float64
	StrengthClip       float64
	PromptName         string
	PromptText         string
	NegativePrompt     string
	Steps              int
	CFG                float64
	SamplerName        string
	Scheduler          string
	Seed               int64
	Width              int
	Height             int
	VAE                string          // S-157 per-item VAE
	TextEncoder        string          // S-157 per-item text encoder
	Shift              sql.NullFloat64 // S-157 per-item shift (nullable)
	Status             string
	ComfyUIPromptID    sql.NullString
	OutputPath         sql.NullString
	ErrorMessage       sql.NullString
	ExceptionType      string
	NodeType           string
	Traceback          string
	CreatedAt          string // RFC3339
	UpdatedAt          string // RFC3339
}

// ListSampleJobs returns all sample jobs ordered by created_at ascending (oldest first, FIFO).
// This ordering is used by the job executor for deterministic FIFO pickup.
func (s *Store) ListSampleJobs() ([]model.SampleJob, error) {
	s.logger.Trace("entering ListSampleJobs")
	defer s.logger.Trace("returning from ListSampleJobs")

	return s.listSampleJobsOrdered("ASC")
}

// ListSampleJobsDesc returns all sample jobs ordered by updated_at descending (most recently updated first).
// This ordering is used for UI display so that recently active jobs appear at the top.
func (s *Store) ListSampleJobsDesc() ([]model.SampleJob, error) {
	s.logger.Trace("entering ListSampleJobsDesc")
	defer s.logger.Trace("returning from ListSampleJobsDesc")

	rows, err := s.db.Query(`SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, base_model, checkpoint_filenames, clear_existing, status, total_items, completed_items, error_message, created_at, updated_at
		FROM sample_jobs ORDER BY updated_at DESC`)
	if err != nil {
		s.logger.WithError(err).Error("failed to query sample jobs")
		return nil, fmt.Errorf("querying sample jobs: %w", err)
	}
	defer rows.Close()

	var jobs []model.SampleJob
	for rows.Next() {
		var e sampleJobEntity
		if err := rows.Scan(&e.ID, &e.TrainingRunName, &e.StudyID, &e.StudyName, &e.WorkflowName, &e.VAE, &e.CLIP, &e.Shift, &e.BaseModel, &e.CheckpointFilenames, &e.ClearExisting, &e.Status, &e.TotalItems, &e.CompletedItems, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan sample job row")
			return nil, fmt.Errorf("scanning sample job row: %w", err)
		}
		j, err := sampleJobEntityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating sample jobs")
		return nil, fmt.Errorf("iterating sample jobs: %w", err)
	}
	s.logger.WithField("job_count", len(jobs)).Debug("listed sample jobs from database")
	return jobs, nil
}

// ListSampleJobsPage returns a single page of sample jobs ordered by created_at
// descending (newest first) with id descending as a stable tiebreak. created_at
// is immutable, so this ordering is stable across pages even as jobs are updated
// — a property the UI relies on for seamless lazy loading. limit bounds the page
// size; offset skips that many rows from the start of the ordered set.
func (s *Store) ListSampleJobsPage(limit, offset int) ([]model.SampleJob, error) {
	s.logger.WithFields(logrus.Fields{
		"limit":  limit,
		"offset": offset,
	}).Trace("entering ListSampleJobsPage")
	defer s.logger.Trace("returning from ListSampleJobsPage")

	rows, err := s.db.Query(`SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, base_model, checkpoint_filenames, clear_existing, status, total_items, completed_items, error_message, created_at, updated_at
		FROM sample_jobs ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		s.logger.WithError(err).Error("failed to query sample jobs page")
		return nil, fmt.Errorf("querying sample jobs page: %w", err)
	}
	defer rows.Close()

	var jobs []model.SampleJob
	for rows.Next() {
		var e sampleJobEntity
		if err := rows.Scan(&e.ID, &e.TrainingRunName, &e.StudyID, &e.StudyName, &e.WorkflowName, &e.VAE, &e.CLIP, &e.Shift, &e.BaseModel, &e.CheckpointFilenames, &e.ClearExisting, &e.Status, &e.TotalItems, &e.CompletedItems, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan sample job row")
			return nil, fmt.Errorf("scanning sample job row: %w", err)
		}
		j, err := sampleJobEntityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating sample jobs page")
		return nil, fmt.Errorf("iterating sample jobs page: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"limit":     limit,
		"offset":    offset,
		"job_count": len(jobs),
	}).Debug("listed sample jobs page from database")
	return jobs, nil
}

// CountSampleJobs returns the total number of sample jobs. It is used together
// with ListSampleJobsPage so the UI knows the total across all pages.
func (s *Store) CountSampleJobs() (int, error) {
	s.logger.Trace("entering CountSampleJobs")
	defer s.logger.Trace("returning from CountSampleJobs")

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sample_jobs`).Scan(&count); err != nil {
		s.logger.WithError(err).Error("failed to count sample jobs")
		return 0, fmt.Errorf("counting sample jobs: %w", err)
	}
	s.logger.WithField("job_count", count).Debug("counted sample jobs in database")
	return count, nil
}

// listSampleJobsOrdered is used by ListSampleJobs (ASC order for executor FIFO pickup).
// direction must be "ASC" or "DESC".
func (s *Store) listSampleJobsOrdered(direction string) ([]model.SampleJob, error) {
	rows, err := s.db.Query(`SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, base_model, checkpoint_filenames, clear_existing, status, total_items, completed_items, error_message, created_at, updated_at
		FROM sample_jobs ORDER BY created_at ` + direction)
	if err != nil {
		s.logger.WithError(err).Error("failed to query sample jobs")
		return nil, fmt.Errorf("querying sample jobs: %w", err)
	}
	defer rows.Close()

	var jobs []model.SampleJob
	for rows.Next() {
		var e sampleJobEntity
		if err := rows.Scan(&e.ID, &e.TrainingRunName, &e.StudyID, &e.StudyName, &e.WorkflowName, &e.VAE, &e.CLIP, &e.Shift, &e.BaseModel, &e.CheckpointFilenames, &e.ClearExisting, &e.Status, &e.TotalItems, &e.CompletedItems, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan sample job row")
			return nil, fmt.Errorf("scanning sample job row: %w", err)
		}
		j, err := sampleJobEntityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		jobs = append(jobs, j)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating sample jobs")
		return nil, fmt.Errorf("iterating sample jobs: %w", err)
	}
	s.logger.WithField("job_count", len(jobs)).Debug("listed sample jobs from database")
	return jobs, nil
}

// HasRunningJob returns true if any sample job currently has status "running".
func (s *Store) HasRunningJob() (bool, error) {
	s.logger.Trace("entering HasRunningJob")
	defer s.logger.Trace("returning from HasRunningJob")

	var count int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM sample_jobs WHERE status = 'running'`).Scan(&count)
	if err != nil {
		s.logger.WithError(err).Error("failed to query running job count")
		return false, fmt.Errorf("querying running job count: %w", err)
	}
	s.logger.WithField("running_count", count).Debug("checked for running jobs")
	return count > 0, nil
}

// GetSampleJob returns a single sample job by ID, or sql.ErrNoRows if not found.
func (s *Store) GetSampleJob(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering GetSampleJob")
	defer s.logger.Trace("returning from GetSampleJob")

	var e sampleJobEntity
	err := s.db.QueryRow(
		`SELECT id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, base_model, checkpoint_filenames, clear_existing, status, total_items, completed_items, error_message, created_at, updated_at
		FROM sample_jobs WHERE id = ?`, id,
	).Scan(&e.ID, &e.TrainingRunName, &e.StudyID, &e.StudyName, &e.WorkflowName, &e.VAE, &e.CLIP, &e.Shift, &e.BaseModel, &e.CheckpointFilenames, &e.ClearExisting, &e.Status, &e.TotalItems, &e.CompletedItems, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			s.logger.WithField("sample_job_id", id).Debug("sample job not found in database")
		} else {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id": id,
				"error":         err.Error(),
			}).Error("failed to query sample job")
		}
		return model.SampleJob{}, err
	}
	s.logger.WithField("sample_job_id", id).Debug("fetched sample job from database")
	return sampleJobEntityToModel(e)
}

// CreateSampleJob inserts a new sample job.
func (s *Store) CreateSampleJob(j model.SampleJob) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
	}).Trace("entering CreateSampleJob")
	defer s.logger.Trace("returning from CreateSampleJob")

	entity := sampleJobModelToEntity(j)

	_, err := s.db.Exec(
		`INSERT INTO sample_jobs (id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, base_model, checkpoint_filenames, clear_existing, status, total_items, completed_items, error_message, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entity.ID,
		entity.TrainingRunName,
		entity.StudyID,
		entity.StudyName,
		entity.WorkflowName,
		entity.VAE,
		entity.CLIP,
		entity.Shift,
		entity.BaseModel,
		entity.CheckpointFilenames,
		entity.ClearExisting,
		entity.Status,
		entity.TotalItems,
		entity.CompletedItems,
		entity.ErrorMessage,
		entity.CreatedAt,
		entity.UpdatedAt,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":     j.ID,
			"training_run_name": j.TrainingRunName,
			"error":             err.Error(),
		}).Error("failed to insert sample job into database")
		return fmt.Errorf("inserting sample job: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
	}).Info("inserted sample job into database")
	return nil
}

// CreateSampleJobWithItems inserts a sample job and all of its items inside a
// single database transaction. Either every row (job + items) is committed, or
// nothing is: if any insert fails, the whole transaction is rolled back, leaving
// no job row and no item rows behind. This guarantees job creation is atomic so
// that the executor never observes an orphaned job whose total_items disagrees
// with its actual item count.
//
// All work is performed on the *sql.Tx; no additional connection is acquired so
// the method is safe even when the pool is pinned to a single connection
// (SetMaxOpenConns(1)).
func (s *Store) CreateSampleJobWithItems(j model.SampleJob, items []model.SampleJobItem) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
		"item_count":        len(items),
	}).Trace("entering CreateSampleJobWithItems")
	defer s.logger.Trace("returning from CreateSampleJobWithItems")

	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": j.ID,
			"error":         err.Error(),
		}).Error("failed to begin transaction for sample job creation")
		return fmt.Errorf("beginning transaction: %w", err)
	}
	// Roll back on any early return. Once the transaction is committed this
	// Rollback is a no-op (sql.ErrTxDone), which is fine.
	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(); rbErr != nil && rbErr != sql.ErrTxDone {
				s.logger.WithFields(logrus.Fields{
					"sample_job_id": j.ID,
					"error":         rbErr.Error(),
				}).Warn("failed to roll back sample job creation transaction")
			}
		}
	}()

	jobEntity := sampleJobModelToEntity(j)
	if _, err := tx.Exec(
		`INSERT INTO sample_jobs (id, training_run_name, study_id, study_name, workflow_name, vae, clip, shift, base_model, checkpoint_filenames, clear_existing, status, total_items, completed_items, error_message, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		jobEntity.ID,
		jobEntity.TrainingRunName,
		jobEntity.StudyID,
		jobEntity.StudyName,
		jobEntity.WorkflowName,
		jobEntity.VAE,
		jobEntity.CLIP,
		jobEntity.Shift,
		jobEntity.BaseModel,
		jobEntity.CheckpointFilenames,
		jobEntity.ClearExisting,
		jobEntity.Status,
		jobEntity.TotalItems,
		jobEntity.CompletedItems,
		jobEntity.ErrorMessage,
		jobEntity.CreatedAt,
		jobEntity.UpdatedAt,
	); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":     j.ID,
			"training_run_name": j.TrainingRunName,
			"error":             err.Error(),
		}).Error("failed to insert sample job within transaction")
		return fmt.Errorf("inserting sample job: %w", err)
	}

	for _, item := range items {
		itemEntity := sampleJobItemModelToEntity(item)
		if _, err := tx.Exec(
			`INSERT INTO sample_job_items (id, job_id, checkpoint_filename, comfyui_model_path, lora_model_path, strength_model, strength_clip, prompt_name, prompt_text, negative_prompt, steps, cfg, sampler_name, scheduler, seed, width, height, vae, text_encoder, shift, status, comfyui_prompt_id, output_path, error_message, exception_type, node_type, traceback, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			itemEntity.ID,
			itemEntity.JobID,
			itemEntity.CheckpointFilename,
			itemEntity.ComfyUIModelPath,
			itemEntity.LoraModelPath,
			itemEntity.StrengthModel,
			itemEntity.StrengthClip,
			itemEntity.PromptName,
			itemEntity.PromptText,
			itemEntity.NegativePrompt,
			itemEntity.Steps,
			itemEntity.CFG,
			itemEntity.SamplerName,
			itemEntity.Scheduler,
			itemEntity.Seed,
			itemEntity.Width,
			itemEntity.Height,
			itemEntity.VAE,
			itemEntity.TextEncoder,
			itemEntity.Shift,
			itemEntity.Status,
			itemEntity.ComfyUIPromptID,
			itemEntity.OutputPath,
			itemEntity.ErrorMessage,
			itemEntity.ExceptionType,
			itemEntity.NodeType,
			itemEntity.Traceback,
			itemEntity.CreatedAt,
			itemEntity.UpdatedAt,
		); err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id":      j.ID,
				"sample_job_item_id": item.ID,
				"error":              err.Error(),
			}).Error("failed to insert sample job item within transaction, rolling back")
			return fmt.Errorf("inserting sample job item %s: %w", item.ID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": j.ID,
			"error":         err.Error(),
		}).Error("failed to commit sample job creation transaction")
		return fmt.Errorf("committing sample job creation: %w", err)
	}
	committed = true

	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
		"item_count":        len(items),
	}).Info("inserted sample job and items into database atomically")
	return nil
}

// UpdateSampleJob updates an existing sample job. Returns sql.ErrNoRows if the job does not exist.
func (s *Store) UpdateSampleJob(j model.SampleJob) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
	}).Trace("entering UpdateSampleJob")
	defer s.logger.Trace("returning from UpdateSampleJob")

	entity := sampleJobModelToEntity(j)

	result, err := s.db.Exec(
		`UPDATE sample_jobs SET training_run_name = ?, study_id = ?, study_name = ?, workflow_name = ?, vae = ?, clip = ?, shift = ?, base_model = ?, checkpoint_filenames = ?, clear_existing = ?, status = ?, total_items = ?, completed_items = ?, error_message = ?, updated_at = ?
		WHERE id = ?`,
		entity.TrainingRunName,
		entity.StudyID,
		entity.StudyName,
		entity.WorkflowName,
		entity.VAE,
		entity.CLIP,
		entity.Shift,
		entity.BaseModel,
		entity.CheckpointFilenames,
		entity.ClearExisting,
		entity.Status,
		entity.TotalItems,
		entity.CompletedItems,
		entity.ErrorMessage,
		entity.UpdatedAt,
		entity.ID,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id":     j.ID,
			"training_run_name": j.TrainingRunName,
			"error":             err.Error(),
		}).Error("failed to update sample job in database")
		return fmt.Errorf("updating sample job: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": j.ID,
			"error":         err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("sample_job_id", j.ID).Debug("no rows affected, sample job not found")
		return sql.ErrNoRows
	}
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
	}).Info("updated sample job in database")
	return nil
}

// RecalculateCompletedItems atomically recomputes the stored completed_items
// counter for a job from the authoritative source of truth — the count of
// sample_job_items in status 'completed' — in a single UPDATE statement.
//
// This avoids the get-modify-write race where two concurrent item completions
// both read the old counter, increment, and write back, losing one update.
// Because the count is derived inside the same statement that writes it (and the
// pool is single-writer via SetMaxOpenConns(1)), the persisted value can never
// drift from the actual number of completed items.
//
// It returns the recomputed count and bumps updated_at. Returns sql.ErrNoRows if
// the job does not exist.
func (s *Store) RecalculateCompletedItems(jobID string) (int, error) {
	s.logger.WithField("job_id", jobID).Trace("entering RecalculateCompletedItems")
	defer s.logger.Trace("returning from RecalculateCompletedItems")

	now := time.Now().UTC().Format(time.RFC3339)
	result, err := s.db.Exec(
		`UPDATE sample_jobs
		SET completed_items = (
			SELECT COUNT(*) FROM sample_job_items
			WHERE job_id = ? AND status = ?
		), updated_at = ?
		WHERE id = ?`,
		jobID,
		string(model.SampleJobItemStatusCompleted),
		now,
		jobID,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"job_id": jobID,
			"error":  err.Error(),
		}).Error("failed to recalculate completed_items in database")
		return 0, fmt.Errorf("recalculating completed_items: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"job_id": jobID,
			"error":  err.Error(),
		}).Error("failed to check rows affected for completed_items recalculation")
		return 0, fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("job_id", jobID).Debug("no rows affected, sample job not found")
		return 0, sql.ErrNoRows
	}

	// Read back the recomputed value so callers can broadcast/log the authoritative count.
	var completed int
	if err := s.db.QueryRow(
		`SELECT completed_items FROM sample_jobs WHERE id = ?`, jobID,
	).Scan(&completed); err != nil {
		if err == sql.ErrNoRows {
			return 0, sql.ErrNoRows
		}
		s.logger.WithFields(logrus.Fields{
			"job_id": jobID,
			"error":  err.Error(),
		}).Error("failed to read back recomputed completed_items")
		return 0, fmt.Errorf("reading recomputed completed_items: %w", err)
	}

	s.logger.WithFields(logrus.Fields{
		"job_id":          jobID,
		"completed_items": completed,
	}).Info("recalculated completed_items atomically")
	return completed, nil
}

// DeleteSampleJob removes a sample job and its items by ID. Returns sql.ErrNoRows if the job does not exist.
func (s *Store) DeleteSampleJob(id string) error {
	s.logger.WithField("sample_job_id", id).Trace("entering DeleteSampleJob")
	defer s.logger.Trace("returning from DeleteSampleJob")

	result, err := s.db.Exec("DELETE FROM sample_jobs WHERE id = ?", id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to delete sample job from database")
		return fmt.Errorf("deleting sample job: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_id": id,
			"error":         err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("sample_job_id", id).Debug("no rows affected, sample job not found")
		return sql.ErrNoRows
	}
	s.logger.WithField("sample_job_id", id).Info("deleted sample job from database")
	return nil
}

// ListSampleJobItems returns all items for a specific job, ordered by created_at.
func (s *Store) ListSampleJobItems(jobID string) ([]model.SampleJobItem, error) {
	s.logger.WithField("job_id", jobID).Trace("entering ListSampleJobItems")
	defer s.logger.Trace("returning from ListSampleJobItems")

	rows, err := s.db.Query(`SELECT id, job_id, checkpoint_filename, comfyui_model_path, lora_model_path, strength_model, strength_clip, prompt_name, prompt_text, negative_prompt, steps, cfg, sampler_name, scheduler, seed, width, height, vae, text_encoder, shift, status, comfyui_prompt_id, output_path, error_message, exception_type, node_type, traceback, created_at, updated_at
		FROM sample_job_items WHERE job_id = ? ORDER BY created_at`, jobID)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"job_id": jobID,
			"error":  err.Error(),
		}).Error("failed to query sample job items")
		return nil, fmt.Errorf("querying sample job items: %w", err)
	}
	defer rows.Close()

	var items []model.SampleJobItem
	for rows.Next() {
		var e sampleJobItemEntity
		if err := rows.Scan(&e.ID, &e.JobID, &e.CheckpointFilename, &e.ComfyUIModelPath, &e.LoraModelPath, &e.StrengthModel, &e.StrengthClip, &e.PromptName, &e.PromptText, &e.NegativePrompt, &e.Steps, &e.CFG, &e.SamplerName, &e.Scheduler, &e.Seed, &e.Width, &e.Height, &e.VAE, &e.TextEncoder, &e.Shift, &e.Status, &e.ComfyUIPromptID, &e.OutputPath, &e.ErrorMessage, &e.ExceptionType, &e.NodeType, &e.Traceback, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan sample job item row")
			return nil, fmt.Errorf("scanning sample job item row: %w", err)
		}
		i, err := sampleJobItemEntityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		items = append(items, i)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating sample job items")
		return nil, fmt.Errorf("iterating sample job items: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"job_id":     jobID,
		"item_count": len(items),
	}).Debug("listed sample job items from database")
	return items, nil
}

// ListJobsProgress computes per-job item progress for every sample job using
// aggregate queries only — it never loads full item rows for the list path.
//
// It runs two queries:
//  1. A GROUP BY aggregate counting items per (job_id, status). This yields the
//     completed / failed / pending counts for every job in a single scan.
//  2. A targeted SELECT of only failed and skipped rows (typically a small
//     subset) to reconstruct the per-checkpoint failed-item details. This keeps
//     parity with GetProgress/Show without loading the (usually large) set of
//     completed and pending rows.
//
// The returned map is keyed by job_id. Jobs with no items are simply absent
// from the map; callers treat a missing entry as all-zero counts.
//
// failed and skipped item statuses are both folded into ItemStatusCounts.Failed,
// matching the semantics used by GetProgress.
func (s *Store) ListJobsProgress() (map[string]model.JobListProgress, error) {
	s.logger.Trace("entering ListJobsProgress")
	defer s.logger.Trace("returning from ListJobsProgress")

	result := make(map[string]model.JobListProgress)

	// Query 1: aggregate status counts grouped by job.
	countRows, err := s.db.Query(
		`SELECT job_id, status, COUNT(*) FROM sample_job_items GROUP BY job_id, status`,
	)
	if err != nil {
		s.logger.WithError(err).Error("failed to query aggregate sample job item counts")
		return nil, fmt.Errorf("querying aggregate sample job item counts: %w", err)
	}
	defer countRows.Close()

	for countRows.Next() {
		var jobID, status string
		var count int
		if err := countRows.Scan(&jobID, &status, &count); err != nil {
			s.logger.WithError(err).Error("failed to scan aggregate count row")
			return nil, fmt.Errorf("scanning aggregate count row: %w", err)
		}
		p := result[jobID]
		switch model.SampleJobItemStatus(status) {
		case model.SampleJobItemStatusCompleted:
			p.ItemCounts.Completed += count
		case model.SampleJobItemStatusFailed, model.SampleJobItemStatusSkipped:
			p.ItemCounts.Failed += count
		case model.SampleJobItemStatusPending:
			p.ItemCounts.Pending += count
		}
		result[jobID] = p
	}
	if err := countRows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating aggregate count rows")
		return nil, fmt.Errorf("iterating aggregate count rows: %w", err)
	}

	// Query 2: only failed/skipped rows, to rebuild per-checkpoint failed details.
	// This intentionally avoids loading completed/pending rows.
	failedRows, err := s.db.Query(
		`SELECT job_id, checkpoint_filename, error_message, exception_type, node_type, traceback
		FROM sample_job_items
		WHERE status IN (?, ?)`,
		string(model.SampleJobItemStatusFailed),
		string(model.SampleJobItemStatusSkipped),
	)
	if err != nil {
		s.logger.WithError(err).Error("failed to query failed sample job items")
		return nil, fmt.Errorf("querying failed sample job items: %w", err)
	}
	defer failedRows.Close()

	// Accumulate per-job, per-checkpoint unique error messages with their details.
	// jobID -> checkpoint -> errMsg -> detail. A checkpoint with an empty inner map
	// had failed items but no recorded message.
	failed := make(map[string]map[string]map[string]model.CheckpointErrorDetail)

	for failedRows.Next() {
		var jobID, checkpoint string
		var errMsg, exceptionType, nodeType, traceback sql.NullString
		if err := failedRows.Scan(&jobID, &checkpoint, &errMsg, &exceptionType, &nodeType, &traceback); err != nil {
			s.logger.WithError(err).Error("failed to scan failed sample job item row")
			return nil, fmt.Errorf("scanning failed sample job item row: %w", err)
		}
		byCheckpoint, ok := failed[jobID]
		if !ok {
			byCheckpoint = make(map[string]map[string]model.CheckpointErrorDetail)
			failed[jobID] = byCheckpoint
		}
		byMsg, ok := byCheckpoint[checkpoint]
		if !ok {
			byMsg = make(map[string]model.CheckpointErrorDetail)
			byCheckpoint[checkpoint] = byMsg
		}
		if errMsg.String != "" {
			byMsg[errMsg.String] = model.CheckpointErrorDetail{
				ExceptionType: exceptionType.String,
				NodeType:      nodeType.String,
				Traceback:     traceback.String,
			}
		}
	}
	if err := failedRows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating failed sample job item rows")
		return nil, fmt.Errorf("iterating failed sample job item rows: %w", err)
	}

	// Build FailedItemDetails per job using the shared helper (R-022), which owns
	// the sorted ordering and the "unknown error" fallback.
	for jobID, byCheckpoint := range failed {
		p := result[jobID]
		p.FailedItemDetails = model.BuildFailedItemDetails(byCheckpoint)
		result[jobID] = p
	}

	s.logger.WithField("job_count", len(result)).Debug("computed aggregate job progress from store")
	return result, nil
}

// CreateSampleJobItem inserts a new sample job item.
func (s *Store) CreateSampleJobItem(i model.SampleJobItem) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_item_id": i.ID,
		"job_id":             i.JobID,
	}).Trace("entering CreateSampleJobItem")
	defer s.logger.Trace("returning from CreateSampleJobItem")

	entity := sampleJobItemModelToEntity(i)

	_, err := s.db.Exec(
		`INSERT INTO sample_job_items (id, job_id, checkpoint_filename, comfyui_model_path, lora_model_path, strength_model, strength_clip, prompt_name, prompt_text, negative_prompt, steps, cfg, sampler_name, scheduler, seed, width, height, vae, text_encoder, shift, status, comfyui_prompt_id, output_path, error_message, exception_type, node_type, traceback, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entity.ID,
		entity.JobID,
		entity.CheckpointFilename,
		entity.ComfyUIModelPath,
		entity.LoraModelPath,
		entity.StrengthModel,
		entity.StrengthClip,
		entity.PromptName,
		entity.PromptText,
		entity.NegativePrompt,
		entity.Steps,
		entity.CFG,
		entity.SamplerName,
		entity.Scheduler,
		entity.Seed,
		entity.Width,
		entity.Height,
		entity.VAE,
		entity.TextEncoder,
		entity.Shift,
		entity.Status,
		entity.ComfyUIPromptID,
		entity.OutputPath,
		entity.ErrorMessage,
		entity.ExceptionType,
		entity.NodeType,
		entity.Traceback,
		entity.CreatedAt,
		entity.UpdatedAt,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_item_id": i.ID,
			"job_id":             i.JobID,
			"error":              err.Error(),
		}).Error("failed to insert sample job item into database")
		return fmt.Errorf("inserting sample job item: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"sample_job_item_id": i.ID,
		"job_id":             i.JobID,
	}).Debug("inserted sample job item into database")
	return nil
}

// UpdateSampleJobItem updates an existing sample job item. Returns sql.ErrNoRows if the item does not exist.
func (s *Store) UpdateSampleJobItem(i model.SampleJobItem) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_item_id": i.ID,
		"job_id":             i.JobID,
	}).Trace("entering UpdateSampleJobItem")
	defer s.logger.Trace("returning from UpdateSampleJobItem")

	entity := sampleJobItemModelToEntity(i)

	result, err := s.db.Exec(
		`UPDATE sample_job_items SET job_id = ?, checkpoint_filename = ?, comfyui_model_path = ?, lora_model_path = ?, strength_model = ?, strength_clip = ?, prompt_name = ?, prompt_text = ?, negative_prompt = ?, steps = ?, cfg = ?, sampler_name = ?, scheduler = ?, seed = ?, width = ?, height = ?, vae = ?, text_encoder = ?, shift = ?, status = ?, comfyui_prompt_id = ?, output_path = ?, error_message = ?, exception_type = ?, node_type = ?, traceback = ?, updated_at = ?
		WHERE id = ?`,
		entity.JobID,
		entity.CheckpointFilename,
		entity.ComfyUIModelPath,
		entity.LoraModelPath,
		entity.StrengthModel,
		entity.StrengthClip,
		entity.PromptName,
		entity.PromptText,
		entity.NegativePrompt,
		entity.Steps,
		entity.CFG,
		entity.SamplerName,
		entity.Scheduler,
		entity.Seed,
		entity.Width,
		entity.Height,
		entity.VAE,
		entity.TextEncoder,
		entity.Shift,
		entity.Status,
		entity.ComfyUIPromptID,
		entity.OutputPath,
		entity.ErrorMessage,
		entity.ExceptionType,
		entity.NodeType,
		entity.Traceback,
		entity.UpdatedAt,
		entity.ID,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_item_id": i.ID,
			"job_id":             i.JobID,
			"error":              err.Error(),
		}).Error("failed to update sample job item in database")
		return fmt.Errorf("updating sample job item: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"sample_job_item_id": i.ID,
			"error":              err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("sample_job_item_id", i.ID).Debug("no rows affected, sample job item not found")
		return sql.ErrNoRows
	}
	s.logger.WithFields(logrus.Fields{
		"sample_job_item_id": i.ID,
		"job_id":             i.JobID,
	}).Debug("updated sample job item in database")
	return nil
}

// SeedSampleJobs inserts multiple sample jobs directly into the database.
// For each unique study_id referenced by a job, a minimal stub study is
// created if no study with that ID already exists, satisfying the FK constraint.
// This is intended for test infrastructure only (E2E seed endpoint).
func (s *Store) SeedSampleJobs(jobs []model.SampleJob) error {
	s.logger.WithField("job_count", len(jobs)).Trace("entering SeedSampleJobs")
	defer s.logger.Trace("returning from SeedSampleJobs")

	// Collect unique study IDs so we can create stub studies if needed.
	seen := make(map[string]bool)
	for _, j := range jobs {
		if j.StudyID != "" && !seen[j.StudyID] {
			seen[j.StudyID] = true
			if err := s.ensureStubStudy(j.StudyID, j.StudyName); err != nil {
				return fmt.Errorf("ensuring stub study %s: %w", j.StudyID, err)
			}
		}
	}

	for _, j := range jobs {
		if err := s.CreateSampleJob(j); err != nil {
			s.logger.WithFields(logrus.Fields{
				"sample_job_id": j.ID,
				"error":         err.Error(),
			}).Error("failed to seed sample job")
			return fmt.Errorf("seeding sample job %s: %w", j.ID, err)
		}
	}
	s.logger.WithField("job_count", len(jobs)).Info("seeded sample jobs into database")
	return nil
}

// ensureStubStudy inserts a minimal study row with the given ID and name if
// no study with that ID exists. Used by SeedSampleJobs to satisfy the FK
// constraint on sample_jobs(study_id) without requiring a real study to exist.
func (s *Store) ensureStubStudy(studyID, studyName string) error {
	// Check if the study already exists.
	var count int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM studies WHERE id = ?", studyID).Scan(&count); err != nil {
		return fmt.Errorf("checking study existence: %w", err)
	}
	if count > 0 {
		return nil // Study already exists; nothing to do.
	}

	name := studyName
	if name == "" {
		name = "Stub Study " + studyID
	}
	now := time.Now().UTC().Format(time.RFC3339)

	_, err := s.db.Exec(
		`INSERT INTO studies (id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, created_at, updated_at)
		VALUES (?, ?, '', '[]', '', '[]', '[]', '[]', '[]', 512, 512, ?, ?)`,
		studyID, name, now, now,
	)
	if err != nil {
		return fmt.Errorf("inserting stub study: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"study_id":   studyID,
		"study_name": name,
	}).Debug("stub study created for job seeding")
	return nil
}

func sampleJobEntityToModel(e sampleJobEntity) (model.SampleJob, error) {
	createdAt, err := time.Parse(time.RFC3339, e.CreatedAt)
	if err != nil {
		return model.SampleJob{}, fmt.Errorf("parsing created_at: %w", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, e.UpdatedAt)
	if err != nil {
		return model.SampleJob{}, fmt.Errorf("parsing updated_at: %w", err)
	}

	var shift *float64
	if e.Shift.Valid {
		shift = &e.Shift.Float64
	}

	var checkpointFilenames []string
	if e.CheckpointFilenames != "" && e.CheckpointFilenames != "[]" {
		if err := json.Unmarshal([]byte(e.CheckpointFilenames), &checkpointFilenames); err != nil {
			return model.SampleJob{}, fmt.Errorf("parsing checkpoint_filenames: %w", err)
		}
	}
	if checkpointFilenames == nil {
		checkpointFilenames = []string{}
	}

	return model.SampleJob{
		ID:                  e.ID,
		TrainingRunName:     e.TrainingRunName,
		StudyID:             e.StudyID,
		StudyName:           e.StudyName,
		WorkflowName:        e.WorkflowName,
		VAE:                 e.VAE.String,
		CLIP:                e.CLIP.String,
		Shift:               shift,
		BaseModel:           e.BaseModel,
		CheckpointFilenames: checkpointFilenames,
		ClearExisting:       e.ClearExisting,
		Status:              model.SampleJobStatus(e.Status),
		TotalItems:          e.TotalItems,
		CompletedItems:      e.CompletedItems,
		ErrorMessage:        e.ErrorMessage.String,
		CreatedAt:           createdAt,
		UpdatedAt:           updatedAt,
	}, nil
}

func sampleJobModelToEntity(j model.SampleJob) sampleJobEntity {
	vae := sql.NullString{String: j.VAE, Valid: j.VAE != ""}
	clip := sql.NullString{String: j.CLIP, Valid: j.CLIP != ""}
	var shift sql.NullFloat64
	if j.Shift != nil {
		shift = sql.NullFloat64{Float64: *j.Shift, Valid: true}
	}
	errMsg := sql.NullString{String: j.ErrorMessage, Valid: j.ErrorMessage != ""}

	checkpointFilenames := "[]"
	if len(j.CheckpointFilenames) > 0 {
		b, err := json.Marshal(j.CheckpointFilenames)
		if err == nil {
			checkpointFilenames = string(b)
		}
	}

	return sampleJobEntity{
		ID:                  j.ID,
		TrainingRunName:     j.TrainingRunName,
		StudyID:             j.StudyID,
		StudyName:           j.StudyName,
		WorkflowName:        j.WorkflowName,
		VAE:                 vae,
		CLIP:                clip,
		Shift:               shift,
		BaseModel:           j.BaseModel,
		CheckpointFilenames: checkpointFilenames,
		ClearExisting:       j.ClearExisting,
		Status:              string(j.Status),
		TotalItems:          j.TotalItems,
		CompletedItems:      j.CompletedItems,
		ErrorMessage:        errMsg,
		CreatedAt:           j.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:           j.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// nullFloatToPtr converts a sql.NullFloat64 to a *float64 (nil when invalid).
func nullFloatToPtr(n sql.NullFloat64) *float64 {
	if !n.Valid {
		return nil
	}
	v := n.Float64
	return &v
}

// ptrToNullFloat converts a *float64 to a sql.NullFloat64 (invalid when nil).
func ptrToNullFloat(p *float64) sql.NullFloat64 {
	if p == nil {
		return sql.NullFloat64{}
	}
	return sql.NullFloat64{Float64: *p, Valid: true}
}

func sampleJobItemEntityToModel(e sampleJobItemEntity) (model.SampleJobItem, error) {
	createdAt, err := time.Parse(time.RFC3339, e.CreatedAt)
	if err != nil {
		return model.SampleJobItem{}, fmt.Errorf("parsing created_at: %w", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, e.UpdatedAt)
	if err != nil {
		return model.SampleJobItem{}, fmt.Errorf("parsing updated_at: %w", err)
	}

	return model.SampleJobItem{
		ID:                 e.ID,
		JobID:              e.JobID,
		CheckpointFilename: e.CheckpointFilename,
		ComfyUIModelPath:   e.ComfyUIModelPath,
		LoraModelPath:      e.LoraModelPath,
		StrengthModel:      e.StrengthModel,
		StrengthClip:       e.StrengthClip,
		PromptName:         e.PromptName,
		PromptText:         e.PromptText,
		NegativePrompt:     e.NegativePrompt,
		Steps:              e.Steps,
		CFG:                e.CFG,
		SamplerName:        e.SamplerName,
		Scheduler:          e.Scheduler,
		Seed:               e.Seed,
		Width:              e.Width,
		Height:             e.Height,
		VAE:                e.VAE,
		TextEncoder:        e.TextEncoder,
		Shift:              nullFloatToPtr(e.Shift),
		Status:             model.SampleJobItemStatus(e.Status),
		ComfyUIPromptID:    e.ComfyUIPromptID.String,
		OutputPath:         e.OutputPath.String,
		ErrorMessage:       e.ErrorMessage.String,
		ExceptionType:      e.ExceptionType,
		NodeType:           e.NodeType,
		Traceback:          e.Traceback,
		CreatedAt:          createdAt,
		UpdatedAt:          updatedAt,
	}, nil
}

func sampleJobItemModelToEntity(i model.SampleJobItem) sampleJobItemEntity {
	promptID := sql.NullString{String: i.ComfyUIPromptID, Valid: i.ComfyUIPromptID != ""}
	outputPath := sql.NullString{String: i.OutputPath, Valid: i.OutputPath != ""}
	errMsg := sql.NullString{String: i.ErrorMessage, Valid: i.ErrorMessage != ""}

	return sampleJobItemEntity{
		ID:                 i.ID,
		JobID:              i.JobID,
		CheckpointFilename: i.CheckpointFilename,
		ComfyUIModelPath:   i.ComfyUIModelPath,
		LoraModelPath:      i.LoraModelPath,
		StrengthModel:      i.StrengthModel,
		StrengthClip:       i.StrengthClip,
		PromptName:         i.PromptName,
		PromptText:         i.PromptText,
		NegativePrompt:     i.NegativePrompt,
		Steps:              i.Steps,
		CFG:                i.CFG,
		SamplerName:        i.SamplerName,
		Scheduler:          i.Scheduler,
		Seed:               i.Seed,
		Width:              i.Width,
		Height:             i.Height,
		VAE:                i.VAE,
		TextEncoder:        i.TextEncoder,
		Shift:              ptrToNullFloat(i.Shift),
		Status:             string(i.Status),
		ComfyUIPromptID:    promptID,
		OutputPath:         outputPath,
		ErrorMessage:       errMsg,
		ExceptionType:      i.ExceptionType,
		NodeType:           i.NodeType,
		Traceback:          i.Traceback,
		CreatedAt:          i.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          i.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
