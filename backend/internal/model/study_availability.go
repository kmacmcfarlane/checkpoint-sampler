package model

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
}
