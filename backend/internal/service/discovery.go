package service

import (
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
)

// stepSuffixPattern matches -step<digits> at the end of a base name.
var stepSuffixPattern = regexp.MustCompile(`-step(\d+)$`)

// epochSuffixPattern matches -<exactly 6 digits> at the end of a base name.
var epochSuffixPattern = regexp.MustCompile(`-(\d{6})$`)

// CheckpointFileSystem defines filesystem operations needed by the discovery service.
type CheckpointFileSystem interface {
	ListSafetensorsFiles(root string) ([]string, error)
	DirectoryExists(path string) bool
}

// DiscoveryService discovers training runs by scanning checkpoint directories.
type DiscoveryService struct {
	fs             CheckpointFileSystem
	checkpointDirs []string
	sampleDir      string
}

// NewDiscoveryService creates a discovery service.
func NewDiscoveryService(fs CheckpointFileSystem, checkpointDirs []string, sampleDir string) *DiscoveryService {
	return &DiscoveryService{
		fs:             fs,
		checkpointDirs: checkpointDirs,
		sampleDir:      sampleDir,
	}
}

// Discover scans all checkpoint directories and returns auto-discovered training runs.
func (d *DiscoveryService) Discover() ([]model.TrainingRun, error) {
	// Map: training run name → list of checkpoints
	runMap := make(map[string][]model.Checkpoint)

	for dirIdx, checkpointDir := range d.checkpointDirs {
		files, err := d.fs.ListSafetensorsFiles(checkpointDir)
		if err != nil {
			return nil, fmt.Errorf("scanning checkpoint_dirs[%d] %q: %w", dirIdx, checkpointDir, err)
		}

		for _, relPath := range files {
			filename := path.Base(relPath)
			baseName := stripCheckpointSuffixes(filename)

			// Include directory path for grouping
			dir := path.Dir(relPath)
			var runName string
			if dir == "." {
				runName = baseName
			} else {
				runName = dir + "/" + baseName
			}

			stepNum := extractStepNumber(filename)

			// Check if sample directory exists
			sampleDirPath := filepath.Join(d.sampleDir, filename)
			hasSamples := d.fs.DirectoryExists(sampleDirPath)

			checkpoint := model.Checkpoint{
				Filename:           filename,
				RelativePath:       relPath,
				CheckpointDirIndex: dirIdx,
				StepNumber:         stepNum,
				HasSamples:         hasSamples,
			}

			runMap[runName] = append(runMap[runName], checkpoint)
		}
	}

	// Build training runs
	runs := make([]model.TrainingRun, 0, len(runMap))
	for name, checkpoints := range runMap {
		// Sort checkpoints by step number (final checkpoint sorted last)
		sort.Slice(checkpoints, func(i, j int) bool {
			si, sj := checkpoints[i].StepNumber, checkpoints[j].StepNumber
			if si == -1 && sj == -1 {
				return checkpoints[i].Filename < checkpoints[j].Filename
			}
			if si == -1 {
				return false // -1 means final, sorts last
			}
			if sj == -1 {
				return true
			}
			return si < sj
		})

		// Assign max step value to final checkpoint if detectable
		assignFinalCheckpointStep(checkpoints, name)

		hasSamples := false
		for _, cp := range checkpoints {
			if cp.HasSamples {
				hasSamples = true
				break
			}
		}

		runs = append(runs, model.TrainingRun{
			Name:        name,
			Checkpoints: checkpoints,
			HasSamples:  hasSamples,
		})
	}

	// Sort runs by name for deterministic output
	sort.Slice(runs, func(i, j int) bool {
		return runs[i].Name < runs[j].Name
	})

	return runs, nil
}

// stripCheckpointSuffixes removes .safetensors extension and step/epoch suffixes.
func stripCheckpointSuffixes(filename string) string {
	// Remove .safetensors extension
	name := strings.TrimSuffix(filename, ".safetensors")
	if name == filename {
		// Case-insensitive fallback
		lower := strings.ToLower(filename)
		if strings.HasSuffix(lower, ".safetensors") {
			name = filename[:len(filename)-len(".safetensors")]
		}
	}

	// Remove step suffix: -step<NNNNN>
	if loc := stepSuffixPattern.FindStringIndex(name); loc != nil {
		name = name[:loc[0]]
		return name
	}

	// Remove epoch suffix: -<NNNNNN> (exactly 6 digits)
	if loc := epochSuffixPattern.FindStringIndex(name); loc != nil {
		name = name[:loc[0]]
		return name
	}

	return name
}

// extractStepNumber extracts the step/epoch number from a checkpoint filename.
// Returns -1 if no suffix is found (final checkpoint).
func extractStepNumber(filename string) int {
	name := strings.TrimSuffix(filename, ".safetensors")
	if name == filename {
		lower := strings.ToLower(filename)
		if strings.HasSuffix(lower, ".safetensors") {
			name = filename[:len(filename)-len(".safetensors")]
		}
	}

	// Try step suffix first: -step<NNNNN>
	if m := stepSuffixPattern.FindStringSubmatch(name); m != nil {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return n
		}
	}

	// Try epoch suffix: -<NNNNNN>
	if m := epochSuffixPattern.FindStringSubmatch(name); m != nil {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return n
		}
	}

	return -1 // Final checkpoint
}

// assignFinalCheckpointStep tries to detect max training steps from the run name
// and assigns it to any final checkpoint (StepNumber == -1).
func assignFinalCheckpointStep(checkpoints []model.Checkpoint, runName string) {
	// Find the max step from named checkpoints
	maxStep := -1
	for _, cp := range checkpoints {
		if cp.StepNumber > maxStep {
			maxStep = cp.StepNumber
		}
	}

	// Try to extract max steps from training run name (e.g., "steps-9000" in the name)
	stepsInName := regexp.MustCompile(`steps?-(\d+)`)
	if m := stepsInName.FindStringSubmatch(runName); m != nil {
		n, err := strconv.Atoi(m[1])
		if err == nil && n > maxStep {
			maxStep = n
		}
	}

	if maxStep <= 0 {
		return
	}

	// Assign to final checkpoints
	for i := range checkpoints {
		if checkpoints[i].StepNumber == -1 {
			checkpoints[i].StepNumber = maxStep
		}
	}
}
