package fileformat

import (
	"path/filepath"
	"strings"
)

// SanitizeTrainingRunName converts a training run name into a safe single-level
// filesystem directory name by replacing all forward and backward slashes with
// underscores.
//
// Training run names are derived from checkpoint file paths and can contain
// slashes that reflect subdirectory structure (e.g. "qwen/Qwen2-VL" from a
// checkpoint at qwen/Qwen2-VL-base.safetensors). Using these names verbatim as
// filesystem path components creates ambiguous directory depth: the path
// sample_dir/qwen/Qwen2-VL/study-id looks like 3 separate directories rather
// than training-run + study.
//
// Sanitization is filesystem-only. The DB and API continue to store and return
// the original training run name with slashes intact.
//
// Examples:
//
//	"qwen/Qwen2-VL"          → "qwen_Qwen2-VL"
//	"my/nested/run"          → "my_nested_run"
//	"windows\\style"         → "windows_style"
//	"simple-model"           → "simple-model"  (unchanged)
func SanitizeTrainingRunName(name string) string {
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	return name
}

// StudyOutputDir computes the canonical on-disk study output directory for a
// sample job, relative to the sample root:
//
//	{sanitized_training_run_name}/{study_name}[/{base_model_name}]
//
// The training run name is sanitized exactly once (via SanitizeTrainingRunName)
// so it forms a single directory level regardless of slashes in the name.
//
// When baseModel is non-empty (LoRA jobs), an additional directory level is
// appended using only the base model's filename with its extension stripped
// (e.g. "loras/foo.safetensors" → "foo", mirroring the filepath.Base defensive
// handling already used for checkpoint filenames — see B-115). This matches
// the layout that images are actually written into for LoRA jobs.
//
// When baseModel is empty (non-LoRA jobs), the returned path is unchanged:
// {sanitized_training_run_name}/{study_name}, with no trailing slash or empty
// path segment.
//
// B-162: this is the single shared helper for the study output directory.
// Previously the image-write path (job_executor_conn.go), the completeness
// check (job_executor_progress.go), and the manifest write
// (job_executor_workflow.go) each reconstructed this path independently, and
// only the image-write path included the base_model level — causing the
// completeness check to look in the wrong directory and the manifest to be
// written one level above the images for LoRA jobs. All three call sites now
// route through this helper so they cannot diverge again.
func StudyOutputDir(trainingRunName, studyName, baseModel string) string {
	dir := SanitizeTrainingRunName(trainingRunName) + "/" + studyName
	if baseModel != "" {
		baseModelName := strings.TrimSuffix(filepath.Base(baseModel), filepath.Ext(baseModel))
		dir = dir + "/" + baseModelName
	}
	return dir
}
