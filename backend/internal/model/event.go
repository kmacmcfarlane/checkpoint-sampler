package model

// EventType represents the type of filesystem change event.
type EventType string

const (
	EventImageAdded      EventType = "image_added"
	EventImageRemoved    EventType = "image_removed"
	EventDirectoryAdded  EventType = "directory_added"
)

// FSEvent represents a filesystem change event for a training run.
type FSEvent struct {
	// Type is the kind of event that occurred.
	Type EventType
	// Path is the path relative to the sample directory.
	Path string
}
