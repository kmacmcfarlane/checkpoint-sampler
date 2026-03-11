package fileformat

import "strings"

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
