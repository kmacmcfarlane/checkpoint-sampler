package model

// ValidationResult contains the result of validating a sample set
// for a training run. Each checkpoint's sample directory is checked
// for the number of PNG files; the maximum count across all checkpoints
// is treated as "expected", and any checkpoint with fewer files has
// missing samples.
type ValidationResult struct {
	Checkpoints []CheckpointCompletenessInfo
}
