package service

import (
	"fmt"
	"path/filepath"
	"sort"
	"strings"
)

// resolveBaseModelUNETName translates a curated base_model_dir relative path
// (e.g. "qwen/qwen_image_2512_bf16.safetensors") to the authoritative
// unet_name string that ComfyUI's UNETLoader exposes for the same physical
// file. ComfyUI's UNETLoader scans both its diffusion_models and checkpoints
// folders and may prefix checkpoints-folder entries (e.g.
// "checkpoints/qwen/qwen_image_2512_bf16.safetensors"). The base_model_dir
// relative path therefore does NOT match the unet_name namespace directly, and
// submitting it verbatim causes ComfyUI to reject the prompt with a
// value_not_in_list (HTTP 400) error.
//
// Matching rules (in priority order):
//  1. Prefer an entry whose trailing path equals the selected relative path
//     (i.e. the unet_name ends with "/<baseModel>" or equals it exactly).
//  2. Fall back to a basename match (the unet_name's final path segment equals
//     the base model's final path segment).
//  3. Return an error if no entry matches (the base model is not registered in
//     ComfyUI's UNET list).
//  4. Return an error if two or more entries match across different
//     namespaces/folders (ambiguous), naming the conflicting candidates so the
//     operator can disambiguate.
//
// The returned string is always the exact ComfyUI-provided unet_name (with
// whatever folder prefix it carries), never the raw base_model_dir path.
func resolveBaseModelUNETName(baseModel string, unetNames []string) (string, error) {
	selected := normalizeModelPath(baseModel)
	if selected == "" {
		return "", fmt.Errorf("base model is empty")
	}

	// Pass 1: trailing-path match. An entry qualifies when its normalized path
	// equals the selected relative path or ends with "/<selected>".
	var trailingMatches []string
	for _, name := range unetNames {
		if matchesTrailingPath(normalizeModelPath(name), selected) {
			trailingMatches = append(trailingMatches, name)
		}
	}
	if match, err := pickSingleMatch(baseModel, trailingMatches, "trailing path"); match != "" || err != nil {
		return match, err
	}

	// Pass 2: basename fallback. An entry qualifies when its final path segment
	// equals the selected base model's final path segment.
	selectedBase := filepath.Base(selected)
	var basenameMatches []string
	for _, name := range unetNames {
		if filepath.Base(normalizeModelPath(name)) == selectedBase {
			basenameMatches = append(basenameMatches, name)
		}
	}
	if match, err := pickSingleMatch(baseModel, basenameMatches, "basename"); match != "" || err != nil {
		return match, err
	}

	// Pass 3: no match.
	return "", fmt.Errorf(
		"base model %q was not found in ComfyUI's UNET (UNETLoader) list; "+
			"place or register the model in ComfyUI's diffusion_models or checkpoints folder so it appears in UNETLoader, then retry",
		baseModel,
	)
}

// pickSingleMatch returns the single match when exactly one candidate exists,
// an empty string with no error when there are zero candidates (so the caller
// can advance to the next matching pass), and an ambiguity error when two or
// more candidates exist.
func pickSingleMatch(baseModel string, matches []string, stage string) (string, error) {
	switch len(matches) {
	case 0:
		return "", nil
	case 1:
		return matches[0], nil
	default:
		sorted := append([]string(nil), matches...)
		sort.Strings(sorted)
		return "", fmt.Errorf(
			"base model %q matches multiple ComfyUI UNET entries by %s (%s); "+
				"disambiguate by making the base_model_dir selection unambiguous, "+
				"or remove/rename the duplicate so only one UNETLoader entry matches",
			baseModel, stage, strings.Join(sorted, ", "),
		)
	}
}

// normalizeModelPath converts backslash separators to forward slashes and
// trims surrounding whitespace so comparisons are consistent across platforms.
func normalizeModelPath(p string) string {
	return strings.TrimSpace(strings.ReplaceAll(p, "\\", "/"))
}

// matchesTrailingPath reports whether the candidate path equals the selected
// relative path or ends with "/<selected>".
func matchesTrailingPath(candidate, selected string) bool {
	if candidate == selected {
		return true
	}
	return strings.HasSuffix(candidate, "/"+selected)
}
