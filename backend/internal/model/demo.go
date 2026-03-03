package model

// DemoStatus represents whether the demo dataset is currently installed.
type DemoStatus struct {
	Installed bool
}

// DemoStudyName is the name of the demo study directory under sample_dir.
const DemoStudyName = "demo-study"

// DemoPresetName is the name of the demo dimension mapping preset.
const DemoPresetName = "Demo Preset"
