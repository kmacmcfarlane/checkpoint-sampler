package model

// ValidationResult contains the result of validating a sample set
// for a training run. Each checkpoint's sample directory is checked
// for the number of PNG files; the maximum count across all checkpoints
// is treated as "expected", and any checkpoint with fewer files has
// missing samples.
//
// When a study is provided for validation, ExpectedPerCheckpoint is set
// to the study's images-per-checkpoint count, and TotalExpected / TotalVerified
// provide aggregate counts across all checkpoints.
type ValidationResult struct {
	Checkpoints []CheckpointCompletenessInfo
	// ExpectedPerCheckpoint is the study-derived expected count per checkpoint.
	// Zero when no study context is available.
	ExpectedPerCheckpoint int
	// TotalExpected is the aggregate expected count across all checkpoints.
	TotalExpected int
	// TotalVerified is the aggregate verified count across all checkpoints.
	TotalVerified int
	// TotalActual is the aggregate actual file count across all checkpoints.
	TotalActual int
	// TotalMissing is the aggregate missing count across all checkpoints (TotalExpected - TotalActual).
	TotalMissing int
}
