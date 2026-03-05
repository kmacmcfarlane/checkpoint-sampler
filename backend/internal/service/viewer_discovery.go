package service

import (
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// ViewerFileSystem defines filesystem operations needed by the viewer discovery service.
type ViewerFileSystem interface {
	ListSubdirectories(root string) ([]string, error)
	DirectoryExists(path string) bool
}

// ViewerDiscoveryService discovers training runs by scanning the sample directory
// structure instead of checkpoint files. This decouples the viewer from checkpoint
// file discovery — the viewer shows what's been generated, not what could be generated.
//
// Directory structure:
//
//	sample_dir/{study_name}/{checkpoint_filename.safetensors}/ → study samples
//	sample_dir/{checkpoint_filename.safetensors}/              → legacy (non-study) samples
//
// A directory is considered a checkpoint directory if its name ends with ".safetensors".
// Non-safetensors directories at the root level are treated as study directories.
type ViewerDiscoveryService struct {
	fs        ViewerFileSystem
	sampleDir string
	logger    *logrus.Entry
}

// NewViewerDiscoveryService creates a viewer discovery service.
func NewViewerDiscoveryService(fs ViewerFileSystem, sampleDir string, logger *logrus.Logger) *ViewerDiscoveryService {
	return &ViewerDiscoveryService{
		fs:        fs,
		sampleDir: sampleDir,
		logger:    logger.WithField("component", "viewer_discovery"),
	}
}

// DiscoverViewable scans sample_dir for checkpoint directories (with optional study
// subdirectories) and returns training runs derived from the directory names.
// All discovered checkpoints have samples by definition since they exist under sample_dir.
func (d *ViewerDiscoveryService) DiscoverViewable() ([]model.TrainingRun, error) {
	d.logger.Trace("entering DiscoverViewable")
	defer d.logger.Trace("returning from DiscoverViewable")

	// Map: training run name → list of checkpoints
	runMap := make(map[string][]model.Checkpoint)

	// List top-level entries under sample_dir
	topEntries, err := d.fs.ListSubdirectories(d.sampleDir)
	if err != nil {
		d.logger.WithFields(logrus.Fields{
			"path":  d.sampleDir,
			"error": err.Error(),
		}).Error("failed to list sample directory entries")
		return nil, err
	}
	d.logger.WithField("entry_count", len(topEntries)).Debug("listed sample_dir entries")

	for _, entry := range topEntries {
		if isCheckpointDirName(entry) {
			// Legacy: checkpoint dir at root of sample_dir (no study)
			d.addCheckpointDir(runMap, "", entry)
		} else {
			// Study directory: scan for checkpoint subdirectories
			studyDir := filepath.Join(d.sampleDir, entry)
			cpEntries, err := d.fs.ListSubdirectories(studyDir)
			if err != nil {
				d.logger.WithFields(logrus.Fields{
					"study_dir": entry,
					"error":     err.Error(),
				}).Error("failed to list study directory entries")
				return nil, err
			}
			for _, cpEntry := range cpEntries {
				if isCheckpointDirName(cpEntry) {
					d.addCheckpointDir(runMap, entry, cpEntry)
				}
			}
		}
	}

	// Build training runs from the map
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

		runs = append(runs, model.TrainingRun{
			Name:        name,
			Checkpoints: checkpoints,
			HasSamples:  true, // Always true for viewer-discovered runs
		})
	}

	// Sort runs by name for deterministic output
	sort.Slice(runs, func(i, j int) bool {
		return runs[i].Name < runs[j].Name
	})

	d.logger.WithField("run_count", len(runs)).Debug("viewable training runs discovered")
	return runs, nil
}

// addCheckpointDir adds a checkpoint directory to the training run map.
// studyName is the study directory name (empty for legacy root-level checkpoints).
// cpDirName is the checkpoint directory name (e.g., "model-step00001000.safetensors").
func (d *ViewerDiscoveryService) addCheckpointDir(runMap map[string][]model.Checkpoint, studyName string, cpDirName string) {
	filename := cpDirName // The directory name IS the checkpoint filename
	baseName := stripCheckpointSuffixes(filename)

	// Include study name in the run name for scoping
	var runName string
	if studyName != "" {
		runName = studyName + "/" + baseName
	} else {
		runName = baseName
	}

	stepNum := extractStepNumber(filename)

	checkpoint := model.Checkpoint{
		Filename:           filename,
		RelativePath:       filename, // relative within checkpoint_dir (not applicable here, use filename)
		CheckpointDirIndex: 0,        // Not relevant for viewer discovery
		StepNumber:         stepNum,
		HasSamples:         true, // Always true — discovered from sample dir
	}

	runMap[runName] = append(runMap[runName], checkpoint)
}

// isCheckpointDirName returns true if the directory name ends with ".safetensors",
// indicating it's a checkpoint sample directory rather than a study directory.
func isCheckpointDirName(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), ".safetensors")
}

// StudyNameForRun extracts the study output directory prefix from a viewer-discovered
// training run name. This is the portion of the path between sample_dir and the
// checkpoint base name, used to scope validation and scanning to the correct subdirectory.
//
// For study-scoped runs like "study_name/model_base", returns "study_name".
// For legacy (root-level) runs like "model_base", returns "".
func StudyNameForRun(runName string) string {
	dir := path.Dir(runName)
	if dir == "." {
		return ""
	}
	return dir
}
