package model

// StudyVersionInfo describes a single version of a study and whether it has
// sample images for a given training run.
type StudyVersionInfo struct {
	// Version is the version number (e.g. 1, 2, 3).
	Version int
	// HasSamples is true if at least one checkpoint directory exists under
	// this version's output directory that matches a checkpoint in the
	// training run.
	HasSamples bool
}

// StudyAvailability summarizes a study's versions and their sample availability
// for a specific training run.
type StudyAvailability struct {
	// StudyID is the study's unique identifier.
	StudyID string
	// StudyName is the study's display name.
	StudyName string
	// Versions lists all discovered version directories for this study,
	// each annotated with sample availability for the target training run.
	Versions []StudyVersionInfo
}
