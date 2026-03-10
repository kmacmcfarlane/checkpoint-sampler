package model

// DemoStatus represents whether the demo dataset is currently installed.
type DemoStatus struct {
	Installed bool
}

// DemoTrainingRunName is the top-level training run directory for the demo dataset.
// It matches the base name of the demo checkpoint filenames ("demo-model").
const DemoTrainingRunName = "demo-model"

// DemoStudyOutputDir is the study output directory within the demo training run dir.
// The full demo path is: sample_dir/DemoTrainingRunName/DemoStudyOutputDir/checkpoint/
const DemoStudyOutputDir = "demo-study"

// DemoStudyName is the combined path prefix for the demo dataset.
// Deprecated: Use DemoTrainingRunName + "/" + DemoStudyOutputDir for the new layout.
// This constant is kept for backward-compatibility checks only.
const DemoStudyName = DemoTrainingRunName + "/" + DemoStudyOutputDir

// DemoPresetName is the name of the demo dimension mapping preset.
const DemoPresetName = "Demo Preset"
