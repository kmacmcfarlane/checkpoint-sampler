package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// sampleJobEntity is the persistence representation of a sample job.
type sampleJobEntity struct {
	ID               string
	TrainingRunName  string
	SamplePresetID   string
	WorkflowName     string
	VAE              sql.NullString
	CLIP             sql.NullString
	Shift            sql.NullFloat64
	Status           string
	TotalItems       int
	CompletedItems   int
	ErrorMessage     sql.NullString
	CreatedAt        string // RFC3339
	UpdatedAt        string // RFC3339
}

// sampleJobItemEntity is the persistence representation of a sample job item.
type sampleJobItemEntity struct {
	ID                 string
	JobID              string
	CheckpointFilename string
	ComfyUIModelPath   string
	PromptName         string
	PromptText         string
	Steps              int
	CFG                float64
	SamplerName        string
	Scheduler          string
	Seed               int64
	Width              int
	Height             int
	Status             string
	ComfyUIPromptID    sql.NullString
	OutputPath         sql.NullString
	ErrorMessage       sql.NullString
	CreatedAt          string // RFC3339
	UpdatedAt          string // RFC3339
}

// ListSampleJobs returns all sample jobs ordered by created_at descending (newest first).
func (s *Store) ListSampleJobs() ([]model.SampleJob, error) {
	s.logger.Trace("entering ListSampleJobs")
	defer s.logger.Trace("returning from ListSampleJobs")

	rows, err := s.db.Query(`SELECT id, training_run_name, sample_preset_id, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at
		FROM sample_jobs ORDER BY created_at DESC`)
	if err != nil {
		s.logger.WithError(err).Error("failed to query sample jobs")
		return nil, fmt.Errorf("querying sample jobs: %w", err)
	}
	defer rows.Close()

	var jobs []model.SampleJob
	for rows.Next() {
		var e sampleJobEntity
		if err := rows.Scan(&e.ID, &e.TrainingRunName, &e.SamplePresetID, &e.WorkflowName, &e.VAE, &e.CLIP, &e.Shift, &e.Status, &e.TotalItems, &e.CompletedItems, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt); err != nil {
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

// GetSampleJob returns a single sample job by ID, or sql.ErrNoRows if not found.
func (s *Store) GetSampleJob(id string) (model.SampleJob, error) {
	s.logger.WithField("sample_job_id", id).Trace("entering GetSampleJob")
	defer s.logger.Trace("returning from GetSampleJob")

	var e sampleJobEntity
	err := s.db.QueryRow(
		`SELECT id, training_run_name, sample_preset_id, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at
		FROM sample_jobs WHERE id = ?`, id,
	).Scan(&e.ID, &e.TrainingRunName, &e.SamplePresetID, &e.WorkflowName, &e.VAE, &e.CLIP, &e.Shift, &e.Status, &e.TotalItems, &e.CompletedItems, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt)
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
		"sample_job_id":      j.ID,
		"training_run_name":  j.TrainingRunName,
	}).Trace("entering CreateSampleJob")
	defer s.logger.Trace("returning from CreateSampleJob")

	entity := sampleJobModelToEntity(j)

	_, err := s.db.Exec(
		`INSERT INTO sample_jobs (id, training_run_name, sample_preset_id, workflow_name, vae, clip, shift, status, total_items, completed_items, error_message, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entity.ID,
		entity.TrainingRunName,
		entity.SamplePresetID,
		entity.WorkflowName,
		entity.VAE,
		entity.CLIP,
		entity.Shift,
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

// UpdateSampleJob updates an existing sample job. Returns sql.ErrNoRows if the job does not exist.
func (s *Store) UpdateSampleJob(j model.SampleJob) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_id":     j.ID,
		"training_run_name": j.TrainingRunName,
	}).Trace("entering UpdateSampleJob")
	defer s.logger.Trace("returning from UpdateSampleJob")

	entity := sampleJobModelToEntity(j)

	result, err := s.db.Exec(
		`UPDATE sample_jobs SET training_run_name = ?, sample_preset_id = ?, workflow_name = ?, vae = ?, clip = ?, shift = ?, status = ?, total_items = ?, completed_items = ?, error_message = ?, updated_at = ?
		WHERE id = ?`,
		entity.TrainingRunName,
		entity.SamplePresetID,
		entity.WorkflowName,
		entity.VAE,
		entity.CLIP,
		entity.Shift,
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

	rows, err := s.db.Query(`SELECT id, job_id, checkpoint_filename, comfyui_model_path, prompt_name, prompt_text, steps, cfg, sampler_name, scheduler, seed, width, height, status, comfyui_prompt_id, output_path, error_message, created_at, updated_at
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
		if err := rows.Scan(&e.ID, &e.JobID, &e.CheckpointFilename, &e.ComfyUIModelPath, &e.PromptName, &e.PromptText, &e.Steps, &e.CFG, &e.SamplerName, &e.Scheduler, &e.Seed, &e.Width, &e.Height, &e.Status, &e.ComfyUIPromptID, &e.OutputPath, &e.ErrorMessage, &e.CreatedAt, &e.UpdatedAt); err != nil {
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

// CreateSampleJobItem inserts a new sample job item.
func (s *Store) CreateSampleJobItem(i model.SampleJobItem) error {
	s.logger.WithFields(logrus.Fields{
		"sample_job_item_id": i.ID,
		"job_id":             i.JobID,
	}).Trace("entering CreateSampleJobItem")
	defer s.logger.Trace("returning from CreateSampleJobItem")

	entity := sampleJobItemModelToEntity(i)

	_, err := s.db.Exec(
		`INSERT INTO sample_job_items (id, job_id, checkpoint_filename, comfyui_model_path, prompt_name, prompt_text, steps, cfg, sampler_name, scheduler, seed, width, height, status, comfyui_prompt_id, output_path, error_message, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entity.ID,
		entity.JobID,
		entity.CheckpointFilename,
		entity.ComfyUIModelPath,
		entity.PromptName,
		entity.PromptText,
		entity.Steps,
		entity.CFG,
		entity.SamplerName,
		entity.Scheduler,
		entity.Seed,
		entity.Width,
		entity.Height,
		entity.Status,
		entity.ComfyUIPromptID,
		entity.OutputPath,
		entity.ErrorMessage,
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
		`UPDATE sample_job_items SET job_id = ?, checkpoint_filename = ?, comfyui_model_path = ?, prompt_name = ?, prompt_text = ?, steps = ?, cfg = ?, sampler_name = ?, scheduler = ?, seed = ?, width = ?, height = ?, status = ?, comfyui_prompt_id = ?, output_path = ?, error_message = ?, updated_at = ?
		WHERE id = ?`,
		entity.JobID,
		entity.CheckpointFilename,
		entity.ComfyUIModelPath,
		entity.PromptName,
		entity.PromptText,
		entity.Steps,
		entity.CFG,
		entity.SamplerName,
		entity.Scheduler,
		entity.Seed,
		entity.Width,
		entity.Height,
		entity.Status,
		entity.ComfyUIPromptID,
		entity.OutputPath,
		entity.ErrorMessage,
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

	return model.SampleJob{
		ID:              e.ID,
		TrainingRunName: e.TrainingRunName,
		SamplePresetID:  e.SamplePresetID,
		WorkflowName:    e.WorkflowName,
		VAE:             e.VAE.String,
		CLIP:            e.CLIP.String,
		Shift:           shift,
		Status:          model.SampleJobStatus(e.Status),
		TotalItems:      e.TotalItems,
		CompletedItems:  e.CompletedItems,
		ErrorMessage:    e.ErrorMessage.String,
		CreatedAt:       createdAt,
		UpdatedAt:       updatedAt,
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

	return sampleJobEntity{
		ID:              j.ID,
		TrainingRunName: j.TrainingRunName,
		SamplePresetID:  j.SamplePresetID,
		WorkflowName:    j.WorkflowName,
		VAE:             vae,
		CLIP:            clip,
		Shift:           shift,
		Status:          string(j.Status),
		TotalItems:      j.TotalItems,
		CompletedItems:  j.CompletedItems,
		ErrorMessage:    errMsg,
		CreatedAt:       j.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       j.UpdatedAt.UTC().Format(time.RFC3339),
	}
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
		PromptName:         e.PromptName,
		PromptText:         e.PromptText,
		Steps:              e.Steps,
		CFG:                e.CFG,
		SamplerName:        e.SamplerName,
		Scheduler:          e.Scheduler,
		Seed:               e.Seed,
		Width:              e.Width,
		Height:             e.Height,
		Status:             model.SampleJobItemStatus(e.Status),
		ComfyUIPromptID:    e.ComfyUIPromptID.String,
		OutputPath:         e.OutputPath.String,
		ErrorMessage:       e.ErrorMessage.String,
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
		PromptName:         i.PromptName,
		PromptText:         i.PromptText,
		Steps:              i.Steps,
		CFG:                i.CFG,
		SamplerName:        i.SamplerName,
		Scheduler:          i.Scheduler,
		Seed:               i.Seed,
		Width:              i.Width,
		Height:             i.Height,
		Status:             string(i.Status),
		ComfyUIPromptID:    promptID,
		OutputPath:         outputPath,
		ErrorMessage:       errMsg,
		CreatedAt:          i.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:          i.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
