package model

// StudySampleStatus describes how complete a study's sample set is for a
// specific training run.
type StudySampleStatus string

const (
	// StudySampleStatusNone means no matching checkpoint directories exist for
	// any checkpoint in the training run.
	StudySampleStatusNone StudySampleStatus = "none"
	// StudySampleStatusPartial means some but not all checkpoints have a
	// matching sample directory.
	StudySampleStatusPartial StudySampleStatus = "partial"
	// StudySampleStatusComplete means every checkpoint in the training run has
	// a matching sample directory.
	StudySampleStatusComplete StudySampleStatus = "complete"
)

// StudyAvailability summarizes a study's sample availability for a specific
// training run.
type StudyAvailability struct {
	// StudyID is the study's unique identifier.
	StudyID string
	// StudyName is the study's display name.
	StudyName string
	// HasSamples is true if at least one checkpoint directory exists under
	// this study's output directory that matches a checkpoint in the
	// training run.
	HasSamples bool
	// SampleStatus indicates whether the study has no samples, partial
	// coverage, or complete coverage for the training run's checkpoints.
	SampleStatus StudySampleStatus
}
