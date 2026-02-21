package model

// TrainingRun represents an auto-discovered training run, grouped from checkpoint files.
type TrainingRun struct {
	// Name is the base name after stripping checkpoint suffixes (includes relative dir path).
	Name string
	// Checkpoints lists individual checkpoint files belonging to this training run.
	Checkpoints []Checkpoint
	// HasSamples is true if at least one checkpoint has a matching sample directory.
	HasSamples bool
}

// Checkpoint represents a single .safetensors checkpoint file within a training run.
type Checkpoint struct {
	// Filename is the checkpoint filename (without directory path).
	Filename string
	// RelativePath is the path relative to the checkpoint directory root.
	RelativePath string
	// CheckpointDirIndex indicates which checkpoint_dir this file was found in.
	CheckpointDirIndex int
	// StepNumber is the extracted step/epoch number, or -1 if not parseable (final checkpoint).
	StepNumber int
	// HasSamples is true if a matching sample directory exists.
	HasSamples bool
}
