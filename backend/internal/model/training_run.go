package model

// TrainingRun represents an auto-discovered training run, grouped from checkpoint files.
type TrainingRun struct {
	// Name is the base name after stripping checkpoint suffixes (includes relative dir path).
	Name string
	// Checkpoints lists individual checkpoint files belonging to this training run.
	Checkpoints []Checkpoint
	// HasSamples is true if at least one checkpoint has a matching sample directory.
	HasSamples bool
	// TrainingRunDir is the top-level sample directory name (viewer-discovery only).
	// New layout: "qwen_psai4rt-v0.3.0-no-reg". Legacy/checkpoint-source: "".
	TrainingRunDir string
	// StudyLabel is the study directory name within the training run dir (viewer-discovery only).
	// New layout: "My Study". Legacy study: "my-study". Legacy root: "".
	StudyLabel string
	// StudyOutputDir is the full path prefix between sample_dir and checkpoint dirs.
	// New layout: "my-model/My Study". Legacy study: "my-study". Legacy root: "".
	StudyOutputDir string
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
