package api

import (
	"context"
	"fmt"
	"strings"
	"time"

	gensamplejobs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_jobs"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// SampleJobsService implements the generated sample_jobs service interface.
type SampleJobsService struct {
	svc       *service.SampleJobService
	discovery *service.DiscoveryService
	enabled   bool
}

// NewSampleJobsService returns a new SampleJobsService.
// If svc is nil (ComfyUI not configured), all methods return empty results or
// a service_unavailable error rather than panicking.
func NewSampleJobsService(svc *service.SampleJobService, discovery *service.DiscoveryService) *SampleJobsService {
	return &SampleJobsService{
		svc:       svc,
		discovery: discovery,
		enabled:   svc != nil,
	}
}

// List returns all sample jobs ordered by creation time (newest first).
func (s *SampleJobsService) List(ctx context.Context) ([]*gensamplejobs.SampleJobResponse, error) {
	if !s.enabled {
		return []*gensamplejobs.SampleJobResponse{}, nil
	}
	jobs, err := s.svc.List()
	if err != nil {
		return nil, gensamplejobs.MakeInternalError(fmt.Errorf("listing sample jobs: %w", err))
	}
	result := make([]*gensamplejobs.SampleJobResponse, len(jobs))
	for i, j := range jobs {
		progress, err := s.svc.GetProgress(j.ID)
		if err != nil {
			progress = model.JobProgress{
				ItemCounts:        model.ItemStatusCounts{},
				FailedItemDetails: []model.FailedItemDetail{},
			}
		}
		result[i] = sampleJobToResponse(j, progress.ItemCounts, progress.FailedItemDetails)
	}
	return result, nil
}

// Show returns a sample job by ID with progress metrics.
func (s *SampleJobsService) Show(ctx context.Context, p *gensamplejobs.ShowPayload) (*gensamplejobs.SampleJobDetailResponse, error) {
	if !s.enabled {
		return nil, gensamplejobs.MakeServiceUnavailable(fmt.Errorf("sample jobs not available: ComfyUI is not configured"))
	}
	job, err := s.svc.Get(p.ID)
	if err != nil {
		if isNotFound(err) {
			return nil, gensamplejobs.MakeNotFound(err)
		}
		return nil, gensamplejobs.MakeInternalError(fmt.Errorf("fetching sample job: %w", err))
	}

	progress, err := s.svc.GetProgress(p.ID)
	if err != nil {
		return nil, gensamplejobs.MakeInternalError(fmt.Errorf("computing job progress: %w", err))
	}

	return &gensamplejobs.SampleJobDetailResponse{
		Job:      sampleJobToResponse(job, progress.ItemCounts, progress.FailedItemDetails),
		Progress: jobProgressToResponse(progress),
	}, nil
}

// Create creates a new sample job by expanding preset parameters across training run checkpoints.
func (s *SampleJobsService) Create(ctx context.Context, p *gensamplejobs.CreateSampleJobPayload) (*gensamplejobs.SampleJobResponse, error) {
	if !s.enabled {
		return nil, gensamplejobs.MakeInvalidPayload(fmt.Errorf("sample jobs not available: ComfyUI is not configured"))
	}
	// Discover training runs to get checkpoints
	runs, err := s.discovery.Discover()
	if err != nil {
		return nil, gensamplejobs.MakeInvalidPayload(fmt.Errorf("discovering training runs: %w", err))
	}

	// Find the training run by name
	var trainingRun *model.TrainingRun
	for i := range runs {
		if runs[i].Name == p.TrainingRunName {
			trainingRun = &runs[i]
			break
		}
	}
	if trainingRun == nil {
		return nil, gensamplejobs.MakeNotFound(fmt.Errorf("training run %s not found", p.TrainingRunName))
	}

	// Create the job
	var shift *float64
	if p.Shift != nil {
		shift = p.Shift
	}

	job, err := s.svc.Create(
		p.TrainingRunName,
		trainingRun.Checkpoints,
		p.SamplePresetID,
		p.WorkflowName,
		p.Vae,
		p.Clip,
		shift,
		p.CheckpointFilenames,
		p.ClearExisting,
	)
	if err != nil {
		if isNotFound(err) {
			return nil, gensamplejobs.MakeNotFound(err)
		}
		return nil, gensamplejobs.MakeInvalidPayload(fmt.Errorf("creating sample job: %w", err))
	}

	// New job: all items are pending, none completed/failed
	counts := model.ItemStatusCounts{Pending: job.TotalItems}
	return sampleJobToResponse(job, counts, []model.FailedItemDetail{}), nil
}

// Start transitions a pending job to running status.
func (s *SampleJobsService) Start(ctx context.Context, p *gensamplejobs.StartPayload) (*gensamplejobs.SampleJobResponse, error) {
	if !s.enabled {
		return nil, gensamplejobs.MakeServiceUnavailable(fmt.Errorf("sample jobs not available: ComfyUI is not configured"))
	}
	job, err := s.svc.Start(p.ID)
	if err != nil {
		if isNotFound(err) {
			return nil, gensamplejobs.MakeNotFound(err)
		}
		if isServiceUnavailable(err) {
			return nil, gensamplejobs.MakeServiceUnavailable(err)
		}
		// Check if error is about invalid state
		return nil, gensamplejobs.MakeInvalidState(err)
	}
	counts, _ := s.svc.GetItemCounts(p.ID)
	return sampleJobToResponse(job, counts, []model.FailedItemDetail{}), nil
}

// Stop stops a running sample job.
func (s *SampleJobsService) Stop(ctx context.Context, p *gensamplejobs.StopPayload) (*gensamplejobs.SampleJobResponse, error) {
	if !s.enabled {
		return nil, gensamplejobs.MakeInternalError(fmt.Errorf("sample jobs not available: ComfyUI is not configured"))
	}
	job, err := s.svc.Stop(p.ID)
	if err != nil {
		if isNotFound(err) {
			return nil, gensamplejobs.MakeNotFound(err)
		}
		// Check if error is about invalid state
		return nil, gensamplejobs.MakeInvalidState(err)
	}
	counts, _ := s.svc.GetItemCounts(p.ID)
	return sampleJobToResponse(job, counts, []model.FailedItemDetail{}), nil
}

// Resume resumes a stopped sample job.
func (s *SampleJobsService) Resume(ctx context.Context, p *gensamplejobs.ResumePayload) (*gensamplejobs.SampleJobResponse, error) {
	if !s.enabled {
		return nil, gensamplejobs.MakeServiceUnavailable(fmt.Errorf("sample jobs not available: ComfyUI is not configured"))
	}
	job, err := s.svc.Resume(p.ID)
	if err != nil {
		if isNotFound(err) {
			return nil, gensamplejobs.MakeNotFound(err)
		}
		if isServiceUnavailable(err) {
			return nil, gensamplejobs.MakeServiceUnavailable(err)
		}
		// Check if error is about invalid state
		return nil, gensamplejobs.MakeInvalidState(err)
	}
	counts, _ := s.svc.GetItemCounts(p.ID)
	return sampleJobToResponse(job, counts, []model.FailedItemDetail{}), nil
}

// Delete removes a sample job and all its items.
func (s *SampleJobsService) Delete(ctx context.Context, p *gensamplejobs.DeletePayload) error {
	if !s.enabled {
		return gensamplejobs.MakeInternalError(fmt.Errorf("sample jobs not available: ComfyUI is not configured"))
	}
	err := s.svc.Delete(p.ID)
	if err != nil {
		if isNotFound(err) {
			return gensamplejobs.MakeNotFound(err)
		}
		return gensamplejobs.MakeInternalError(fmt.Errorf("deleting sample job: %w", err))
	}
	return nil
}

func sampleJobToResponse(j model.SampleJob, counts model.ItemStatusCounts, failedDetails []model.FailedItemDetail) *gensamplejobs.SampleJobResponse {
	resp := &gensamplejobs.SampleJobResponse{
		ID:              j.ID,
		TrainingRunName: j.TrainingRunName,
		SamplePresetID:  j.SamplePresetID,
		WorkflowName:    j.WorkflowName,
		Status:          string(j.Status),
		TotalItems:      j.TotalItems,
		CompletedItems:  j.CompletedItems,
		FailedItems:     counts.Failed,
		PendingItems:    counts.Pending,
		CreatedAt:       j.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:       j.UpdatedAt.UTC().Format(time.RFC3339),
	}

	if j.VAE != "" {
		resp.Vae = &j.VAE
	}

	if j.CLIP != "" {
		resp.Clip = &j.CLIP
	}

	if j.Shift != nil {
		resp.Shift = j.Shift
	}

	if j.ErrorMessage != "" {
		resp.ErrorMessage = &j.ErrorMessage
	}

	// Populate failed item details
	resp.FailedItemDetails = make([]*gensamplejobs.FailedItemDetailResponse, len(failedDetails))
	for i, d := range failedDetails {
		resp.FailedItemDetails[i] = &gensamplejobs.FailedItemDetailResponse{
			CheckpointFilename: d.CheckpointFilename,
			ErrorMessage:       d.ErrorMessage,
		}
	}

	return resp
}

func jobProgressToResponse(p model.JobProgress) *gensamplejobs.JobProgressResponse {
	resp := &gensamplejobs.JobProgressResponse{
		CheckpointsCompleted: p.CheckpointsCompleted,
		TotalCheckpoints:     p.TotalCheckpoints,
	}

	if p.CurrentCheckpoint != "" {
		resp.CurrentCheckpoint = &p.CurrentCheckpoint
	}

	if p.CurrentCheckpointTotal > 0 {
		resp.CurrentCheckpointProgress = &p.CurrentCheckpointProgress
		resp.CurrentCheckpointTotal = &p.CurrentCheckpointTotal
	}

	if p.EstimatedCompletionTime != nil {
		t := p.EstimatedCompletionTime.UTC().Format(time.RFC3339)
		resp.EstimatedCompletionTime = &t
	}

	return resp
}

func isServiceUnavailable(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "ComfyUI not connected") || strings.Contains(msg, "service unavailable")
}
