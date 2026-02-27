package model

// EventType represents the type of filesystem change event.
type EventType string

const (
	EventImageAdded      EventType = "image_added"
	EventImageRemoved    EventType = "image_removed"
	EventDirectoryAdded  EventType = "directory_added"
	EventJobProgress     EventType = "job_progress"
)

// FSEvent represents a filesystem change event for a training run.
type FSEvent struct {
	// Type is the kind of event that occurred.
	Type EventType
	// Path is the path relative to the sample directory.
	Path string
	// JobProgressData contains optional job progress data (only for job_progress events).
	JobProgressData *JobProgressEventData
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
}
