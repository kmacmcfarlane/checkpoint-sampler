package model

// EventType represents the type of filesystem change event.
type EventType string

const (
	EventImageAdded         EventType = "image_added"
	EventImageRemoved       EventType = "image_removed"
	EventDirectoryAdded     EventType = "directory_added"
	EventJobProgress        EventType = "job_progress"
	EventInferenceProgress  EventType = "inference_progress"
)

// FSEvent represents a filesystem change event for a training run.
type FSEvent struct {
	// Type is the kind of event that occurred.
	Type EventType
	// Path is the path relative to the sample directory.
	Path string
	// JobProgressData contains optional job progress data (only for job_progress events).
	JobProgressData *JobProgressEventData
	// InferenceProgressData contains optional per-node inference progress data
	// (only for inference_progress events).
	InferenceProgressData *InferenceProgressEventData
}

// JobProgressEventData contains the data sent with a job_progress event.
type JobProgressEventData struct {
	JobID                      string
	Status                     string
	TotalItems                 int
	CompletedItems             int
	FailedItems                int
	PendingItems               int
	CheckpointsCompleted       int
	TotalCheckpoints           int
	CurrentCheckpoint          string
	CurrentCheckpointProgress  int
	CurrentCheckpointTotal     int
	CheckpointCompleteness     []CheckpointCompletenessInfo
	FailedItemDetails          []FailedItemDetail
}

// InferenceProgressEventData contains per-node inference progress from ComfyUI.
// ComfyUI sends "progress" events with value/max as each sampler step completes.
type InferenceProgressEventData struct {
	PromptID     string
	CurrentValue int
	MaxValue     int
}

// CheckpointCompletenessInfo holds the result of verifying that expected images
// exist on disk for a completed checkpoint.
type CheckpointCompletenessInfo struct {
	Checkpoint string
	Expected   int
	Verified   int
	Missing    int
}
