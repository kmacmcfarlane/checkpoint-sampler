package model

import "time"

// SampleJob represents a job that generates sample images for a training run.
type SampleJob struct {
	ID               string
	TrainingRunName  string
	SamplePresetID   string
	WorkflowName     string
	VAE              string
	CLIP             string
	Shift            *float64 // nullable for workflows without shift role
	Status           SampleJobStatus
	TotalItems       int
	CompletedItems   int
	ErrorMessage     string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// SampleJobStatus represents the state of a sample job.
type SampleJobStatus string

const (
	SampleJobStatusPending   SampleJobStatus = "pending"
	SampleJobStatusRunning   SampleJobStatus = "running"
	SampleJobStatusPaused    SampleJobStatus = "paused"
	SampleJobStatusCompleted SampleJobStatus = "completed"
	SampleJobStatusFailed    SampleJobStatus = "failed"
)

// SampleJobItem represents a single work item in a sample job.
type SampleJobItem struct {
	ID                 string
	JobID              string
	CheckpointFilename string
	ComfyUIModelPath   string
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
	Status             SampleJobItemStatus
	ComfyUIPromptID    string
	OutputPath         string
	ErrorMessage       string
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

// SampleJobItemStatus represents the state of a sample job item.
type SampleJobItemStatus string

const (
	SampleJobItemStatusPending   SampleJobItemStatus = "pending"
	SampleJobItemStatusRunning   SampleJobItemStatus = "running"
	SampleJobItemStatusCompleted SampleJobItemStatus = "completed"
	SampleJobItemStatusFailed    SampleJobItemStatus = "failed"
	SampleJobItemStatusSkipped   SampleJobItemStatus = "skipped"
)

// JobProgress contains computed progress metrics for a sample job.
type JobProgress struct {
	CheckpointsCompleted      int
	TotalCheckpoints          int
	CurrentCheckpoint         string
	CurrentCheckpointProgress int
	CurrentCheckpointTotal    int
	EstimatedCompletionTime   *time.Time
}
