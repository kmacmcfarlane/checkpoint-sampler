package service

import (
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// stepSuffixPattern matches -step<digits> at the end of a base name.
var stepSuffixPattern = regexp.MustCompile(`-step(\d+)$`)

// epochSuffixPattern matches -<exactly 6 digits> at the end of a base name.
var epochSuffixPattern = regexp.MustCompile(`-(\d{6})$`)

// CheckpointFileSystem defines filesystem operations needed by the discovery service.
type CheckpointFileSystem interface {
	ListSafetensorsFiles(root string) ([]string, error)
	DirectoryExists(path string) bool
	// ListSubdirectories returns the names of immediate subdirectories under root.
	// Implementations return an empty slice (not an error) when root does not exist.
	ListSubdirectories(root string) ([]string, error)
}

// DiscoveryService discovers training runs by scanning checkpoint and LoRA directories.
type DiscoveryService struct {
	fs             CheckpointFileSystem
	checkpointDirs []string
	loraDirs       []string
	sampleDir      string
	logger         *logrus.Entry
}

// NewDiscoveryService creates a discovery service.
func NewDiscoveryService(fs CheckpointFileSystem, checkpointDirs []string, loraDirs []string, sampleDir string, logger *logrus.Logger) *DiscoveryService {
	return &DiscoveryService{
		fs:             fs,
		checkpointDirs: checkpointDirs,
		loraDirs:       loraDirs,
		sampleDir:      sampleDir,
		logger:         logger.WithField("component", "discovery"),
	}
}

// Discover scans all checkpoint and LoRA directories and returns auto-discovered training runs.
func (d *DiscoveryService) Discover() ([]model.TrainingRun, error) {
	d.logger.Trace("entering Discover")
	defer d.logger.Trace("returning from Discover")

	// dirSource tracks which Kind to assign to runs from each scanned directory group.
	type dirSource struct {
		dirs []string
		kind model.TrainingRunKind
		label string // for error messages (e.g. "checkpoint_dirs", "lora_dirs")
	}
	sources := []dirSource{
		{dirs: d.checkpointDirs, kind: model.TrainingRunKindCheckpoint, label: "checkpoint_dirs"},
		{dirs: d.loraDirs, kind: model.TrainingRunKindLoRA, label: "lora_dirs"},
	}

	// Build the set of checkpoint sample-directory names that exist anywhere under
	// the sample tree. Sample output is nested differently per training run kind:
	//
	//	{sampleDir}/{checkpoint.safetensors}/                                 (legacy no-study)
	//	{sampleDir}/{study}/{checkpoint.safetensors}/                         (legacy study)
	//	{sampleDir}/{training_run}/{study}/{checkpoint.safetensors}/          (checkpoint runs)
	//	{sampleDir}/{training_run}/{study}/{base_model}/{checkpoint.safetensors}/ (LoRA runs)
	//
	// The previous implementation only checked the flat legacy path
	// ({sampleDir}/{filename}), so has_samples was always false for the deeper
	// checkpoint-run and LoRA layouts even though samples existed on disk.
	sampleCheckpointDirs := d.collectSampleCheckpointDirs()

	// Map: training run name → list of checkpoints
	runMap := make(map[string][]model.Checkpoint)
	// Map: training run name → kind (determined by directory source)
	kindMap := make(map[string]model.TrainingRunKind)

	for _, src := range sources {
		for dirIdx, dir := range src.dirs {
			d.logger.WithFields(logrus.Fields{
				"dir_index": dirIdx,
				"path":      dir,
				"kind":      string(src.kind),
			}).Debug("scanning directory")
			files, err := d.fs.ListSafetensorsFiles(dir)
			if err != nil {
				d.logger.WithFields(logrus.Fields{
					"dir_index": dirIdx,
					"path":      dir,
					"error":     err.Error(),
				}).Error("failed to list safetensors files")
				return nil, fmt.Errorf("scanning %s[%d] %q: %w", src.label, dirIdx, dir, err)
			}
			d.logger.WithFields(logrus.Fields{
				"dir_index":  dirIdx,
				"file_count": len(files),
			}).Debug("found safetensors files")

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

				// A checkpoint has samples if a sample directory named after its
				// .safetensors filename exists anywhere in the sample tree (any of
				// the supported nesting layouts, including the LoRA layout which
				// adds a {base_model_name} level). Fall back to the legacy flat
				// path check so a missing/empty index never under-reports.
				hasSamples := sampleCheckpointDirs[filename] || d.fs.DirectoryExists(filepath.Join(d.sampleDir, filename))

				checkpoint := model.Checkpoint{
					Filename:           filename,
					RelativePath:       relPath,
					CheckpointDirIndex: dirIdx,
					StepNumber:         stepNum,
					HasSamples:         hasSamples,
				}

				runMap[runName] = append(runMap[runName], checkpoint)
				kindMap[runName] = src.kind
			}
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
			Kind:        kindMap[name],
			Checkpoints: checkpoints,
			HasSamples:  hasSamples,
		})
	}

	// Sort runs by name for deterministic output
	sort.Slice(runs, func(i, j int) bool {
		return runs[i].Name < runs[j].Name
	})

	d.logger.WithField("run_count", len(runs)).Debug("training runs discovered")
	return runs, nil
}

// collectSampleCheckpointDirs scans the sample directory tree and returns the set
// of checkpoint sample-directory names (directories whose name ends in
// ".safetensors") found at any of the supported nesting depths. Samples are
// written under one of the following layouts depending on training run kind:
//
//	{sampleDir}/{checkpoint.safetensors}/                                     (legacy no-study)
//	{sampleDir}/{study}/{checkpoint.safetensors}/                             (legacy study)
//	{sampleDir}/{training_run}/{study}/{checkpoint.safetensors}/              (checkpoint runs)
//	{sampleDir}/{training_run}/{study}/{base_model}/{checkpoint.safetensors}/ (LoRA runs)
//
// The returned set is keyed by checkpoint filename (the directory name), which
// matches model.Checkpoint.Filename produced during discovery. This mirrors the
// traversal performed by ViewerDiscoveryService so that has_samples detection
// and the sample-grid listing agree on which checkpoints have samples.
//
// Filesystem errors are tolerated (logged, then skipped) so that a single
// unreadable subdirectory does not prevent detection for the rest of the tree.
func (d *DiscoveryService) collectSampleCheckpointDirs() map[string]bool {
	found := make(map[string]bool)

	// recordIfCheckpoint adds name to the set when it is a checkpoint sample dir.
	recordIfCheckpoint := func(name string) bool {
		if isCheckpointDirName(name) {
			found[name] = true
			return true
		}
		return false
	}

	listSub := func(parts ...string) []string {
		dir := filepath.Join(append([]string{d.sampleDir}, parts...)...)
		subs, err := d.fs.ListSubdirectories(dir)
		if err != nil {
			d.logger.WithFields(logrus.Fields{
				"dir":   dir,
				"error": err.Error(),
			}).Warn("failed to list sample subdirectories during has-samples scan")
			return nil
		}
		return subs
	}

	for _, l0 := range listSub() {
		if recordIfCheckpoint(l0) {
			continue // legacy no-study checkpoint dir
		}
		// l0 is a study dir (legacy) or a training_run dir (new layout).
		for _, l1 := range listSub(l0) {
			if recordIfCheckpoint(l1) {
				continue // legacy study layout: {study}/{checkpoint}/
			}
			// l1 is a study dir under a training_run dir.
			for _, l2 := range listSub(l0, l1) {
				if recordIfCheckpoint(l2) {
					continue // checkpoint-run layout: {run}/{study}/{checkpoint}/
				}
				// l2 is a base_model dir (LoRA layout); checkpoints live one level deeper.
				for _, l3 := range listSub(l0, l1, l2) {
					recordIfCheckpoint(l3)
				}
			}
		}
	}

	return found
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
