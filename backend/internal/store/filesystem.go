package store

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/sirupsen/logrus"
)

// Sentinel errors for filesystem resolution. Callers (notably the API transport
// layer) classify failures with errors.Is against these sentinels rather than
// matching error message substrings (DEVELOPMENT_PRACTICES §3.2). The sentinels
// never carry an absolute server path; the path is logged server-side instead.
var (
	// ErrInvalidImagePath indicates a supplied relative image path failed safety
	// validation (empty, absolute, contains traversal components, or escapes the
	// sample root).
	ErrInvalidImagePath = errors.New("invalid image path")

	// ErrImageNotFound indicates the requested image file does not exist or is a
	// directory rather than a regular file.
	ErrImageNotFound = errors.New("image not found")
)

// ImageFile is a regular file opened for streaming. Size is the file size in
// bytes (used for the Content-Length header). The embedded io.ReadSeekCloser
// lets callers sniff the leading bytes for content-type detection and then seek
// back to the start before streaming.
type ImageFile struct {
	io.ReadSeekCloser
	Size int64
}

// FileSystem provides filesystem operations for scanning directories and images.
type FileSystem struct {
	logger *logrus.Entry
}

// NewFileSystem creates a new FileSystem store.
func NewFileSystem(logger *logrus.Logger) *FileSystem {
	return &FileSystem{
		logger: logger.WithField("component", "filesystem"),
	}
}

// ListSafetensorsFiles recursively scans root for .safetensors files and returns
// their paths relative to root.
func (fs *FileSystem) ListSafetensorsFiles(root string) ([]string, error) {
	fs.logger.WithField("root", root).Trace("entering ListSafetensorsFiles")
	defer fs.logger.Trace("returning from ListSafetensorsFiles")

	var files []string

	fs.logger.WithField("root", root).Debug("scanning for safetensors files")
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}

		if strings.EqualFold(filepath.Ext(path), ".safetensors") {
			relPath, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			files = append(files, filepath.ToSlash(relPath))
		}
		return nil
	})
	if err != nil {
		fields := logrus.Fields{
			"root":  root,
			"error": err.Error(),
		}
		if os.IsNotExist(err) {
			fs.logger.WithFields(fields).Debug("directory not found, no safetensors files")
		} else {
			fs.logger.WithFields(fields).Error("failed to scan for safetensors files")
		}
		return nil, fmt.Errorf("scanning for safetensors files: %w", err)
	}

	fs.logger.WithFields(logrus.Fields{
		"root":       root,
		"file_count": len(files),
	}).Debug("safetensors files listed")
	return files, nil
}

// DirectoryExists reports whether the given path exists and is a directory.
func (fs *FileSystem) DirectoryExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// FileExists reports whether the given path exists and is a regular file.
func (fs *FileSystem) FileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// ListPNGFiles returns the names of .png files in the given directory.
// Only regular files with a .png extension (case-insensitive) are returned.
func (fs *FileSystem) ListPNGFiles(dir string) ([]string, error) {
	fs.logger.WithField("directory", dir).Trace("entering ListPNGFiles")
	defer fs.logger.Trace("returning from ListPNGFiles")

	fs.logger.WithField("directory", dir).Debug("reading directory for PNG files")
	entries, err := os.ReadDir(dir)
	if err != nil {
		fields := logrus.Fields{
			"directory": dir,
			"error":     err.Error(),
		}
		if os.IsNotExist(err) {
			fs.logger.WithFields(fields).Debug("directory not found, no PNG files")
		} else {
			fs.logger.WithFields(fields).Error("failed to read directory")
		}
		return nil, fmt.Errorf("reading directory %s: %w", dir, err)
	}

	var files []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.EqualFold(filepath.Ext(entry.Name()), ".png") {
			files = append(files, entry.Name())
		}
	}
	fs.logger.WithFields(logrus.Fields{
		"directory":  dir,
		"file_count": len(files),
	}).Debug("PNG files listed")
	return files, nil
}

// ListSubdirectories returns the names of immediate subdirectories under the given root.
// Only directories are returned; files are skipped. Returns an empty slice (not an error)
// if the root directory does not exist.
func (fs *FileSystem) ListSubdirectories(root string) ([]string, error) {
	fs.logger.WithField("root", root).Trace("entering ListSubdirectories")
	defer fs.logger.Trace("returning from ListSubdirectories")

	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			fs.logger.WithField("root", root).Debug("directory does not exist, returning empty list")
			return []string{}, nil
		}
		fs.logger.WithFields(logrus.Fields{
			"root":  root,
			"error": err.Error(),
		}).Error("failed to read directory")
		return nil, fmt.Errorf("reading directory %s: %w", root, err)
	}

	var dirs []string
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, entry.Name())
		}
	}
	fs.logger.WithFields(logrus.Fields{
		"root":      root,
		"dir_count": len(dirs),
	}).Debug("subdirectories listed")
	return dirs, nil
}

// RemoveSampleDir removes the sample directory for a given checkpoint filename.
// The directory is located at sampleDir/checkpointFilename/.
// If the directory does not exist, this is a no-op (not an error).
func (fs *FileSystem) RemoveSampleDir(sampleDir string, checkpointFilename string) error {
	fs.logger.WithFields(logrus.Fields{
		"checkpoint_filename": checkpointFilename,
		"sample_dir":          sampleDir,
	}).Trace("entering RemoveSampleDir")
	defer fs.logger.Trace("returning from RemoveSampleDir")

	target := filepath.Join(sampleDir, checkpointFilename)
	if err := os.RemoveAll(target); err != nil {
		fs.logger.WithFields(logrus.Fields{
			"target": target,
			"error":  err.Error(),
		}).Error("failed to remove sample directory")
		return fmt.Errorf("removing sample directory %s: %w", target, err)
	}
	fs.logger.WithField("target", target).Info("sample directory removed")
	return nil
}

// StudyOutputDirRemover implements service.SampleDirRemover by removing
// per-checkpoint output directories under {sampleDir}/{sanitizedRunName}/{studyName}/{checkpointFilename}/.
// Only the directories for selected checkpoints are deleted; the rest of the study is preserved.
type StudyOutputDirRemover struct {
	fs        *FileSystem
	sampleDir string
}

// NewStudyOutputDirRemover creates a StudyOutputDirRemover.
func NewStudyOutputDirRemover(fs *FileSystem, sampleDir string) *StudyOutputDirRemover {
	return &StudyOutputDirRemover{fs: fs, sampleDir: sampleDir}
}

// RemoveCheckpointOutputDir removes {sampleDir}/{sanitizedRunName}/{studyName}/{checkpointFilename}/
// and all its contents.
// The training run name is sanitized (slashes replaced with underscores) to match
// the filesystem layout used by the job executor.
// If the directory does not exist, this is a no-op (not an error).
func (r *StudyOutputDirRemover) RemoveCheckpointOutputDir(trainingRunName string, studyName string, checkpointFilename string) error {
	sanitizedRunName := fileformat.SanitizeTrainingRunName(trainingRunName)
	// B-115: use filepath.Base to ensure only the filename is used as directory name
	target := filepath.Join(r.sampleDir, sanitizedRunName, studyName, filepath.Base(checkpointFilename))
	r.fs.logger.WithFields(logrus.Fields{
		"training_run_name":   trainingRunName,
		"sanitized_run_name":  sanitizedRunName,
		"study_name":          studyName,
		"checkpoint_filename": checkpointFilename,
		"target":              target,
	}).Trace("entering RemoveCheckpointOutputDir")
	defer r.fs.logger.Trace("returning from RemoveCheckpointOutputDir")

	if err := os.RemoveAll(target); err != nil {
		r.fs.logger.WithFields(logrus.Fields{
			"target": target,
			"error":  err.Error(),
		}).Error("failed to remove checkpoint output directory")
		return fmt.Errorf("removing checkpoint output directory %s: %w", target, err)
	}
	r.fs.logger.WithField("target", target).Info("checkpoint output directory removed")
	return nil
}

// ReadFile reads the entire contents of a file and returns it as a byte slice.
func (fs *FileSystem) ReadFile(path string) ([]byte, error) {
	fs.logger.WithField("path", path).Trace("entering ReadFile")
	defer fs.logger.Trace("returning from ReadFile")

	data, err := os.ReadFile(path)
	if err != nil {
		fields := logrus.Fields{
			"path":  path,
			"error": err.Error(),
		}
		if os.IsNotExist(err) {
			fs.logger.WithFields(fields).Debug("file not found")
		} else {
			fs.logger.WithFields(fields).Error("failed to read file")
		}
		return nil, err
	}
	return data, nil
}

// RemoveStudyDir removes the sample output directory for a given study name.
// The directory is located at sampleDir/studyName/.
// If the directory does not exist, this is a no-op (not an error).
func (fs *FileSystem) RemoveStudyDir(sampleDir string, studyName string) error {
	fs.logger.WithFields(logrus.Fields{
		"study_name": studyName,
		"sample_dir": sampleDir,
	}).Trace("entering RemoveStudyDir")
	defer fs.logger.Trace("returning from RemoveStudyDir")

	target := filepath.Join(sampleDir, studyName)
	if err := os.RemoveAll(target); err != nil {
		fs.logger.WithFields(logrus.Fields{
			"target": target,
			"error":  err.Error(),
		}).Error("failed to remove study sample directory")
		return fmt.Errorf("removing study sample directory %s: %w", target, err)
	}
	fs.logger.WithField("target", target).Info("study sample directory removed")
	return nil
}

// StudyDirRemover implements service.StudySampleDirRemover by removing the
// per-study sample directory under a configured sample root directory.
type StudyDirRemover struct {
	fs        *FileSystem
	sampleDir string
}

// NewStudyDirRemover creates a StudyDirRemover.
func NewStudyDirRemover(fs *FileSystem, sampleDir string) *StudyDirRemover {
	return &StudyDirRemover{fs: fs, sampleDir: sampleDir}
}

// RemoveStudySampleDir removes sampleDir/studyName/ for the given study.
func (r *StudyDirRemover) RemoveStudySampleDir(studyName string) error {
	return r.fs.RemoveStudyDir(r.sampleDir, studyName)
}

// JobSampleDirRemover implements service.JobSampleDataRemover by removing
// per-checkpoint sample directories under a study directory.
type JobSampleDirRemover struct {
	fs        *FileSystem
	sampleDir string
}

// NewJobSampleDirRemover creates a JobSampleDirRemover.
func NewJobSampleDirRemover(fs *FileSystem, sampleDir string) *JobSampleDirRemover {
	return &JobSampleDirRemover{fs: fs, sampleDir: sampleDir}
}

// RemoveJobSampleDir removes the per-checkpoint output directory for the given
// job, which holds the generated sample images for that checkpoint.
//
// B-164: the deletion root is resolved via fileformat.StudyOutputDir so it
// matches the on-disk layout the job executor actually writes into:
//
//	checkpoint jobs: {sampleDir}/{sanitizedRunName}/{studyName}/{checkpoint}
//	LoRA jobs:       {sampleDir}/{sanitizedRunName}/{studyName}/{baseModelName}/{checkpoint}
//
// Previously this joined {sampleDir}/{studyName}/{checkpoint}, a layout that no
// longer exists after the run-name/base-model restructuring, so delete-with-data
// removed nothing while reporting success (same root-cause family as B-163).
//
// The checkpoint filename is reduced with filepath.Base (B-115) and the final
// target is guarded against escaping the sample directory (path containment) so
// a traversal component in any input cannot delete data outside sampleDir.
func (r *JobSampleDirRemover) RemoveJobSampleDir(trainingRunName string, studyName string, baseModel string, checkpointFilename string) error {
	studyOutputDir := fileformat.StudyOutputDir(trainingRunName, studyName, baseModel)
	target := filepath.Join(r.sampleDir, studyOutputDir, filepath.Base(checkpointFilename))
	r.fs.logger.WithFields(logrus.Fields{
		"training_run_name":   trainingRunName,
		"study_name":          studyName,
		"base_model":          baseModel,
		"checkpoint_filename": checkpointFilename,
		"target":              target,
	}).Trace("entering RemoveJobSampleDir")
	defer r.fs.logger.Trace("returning from RemoveJobSampleDir")

	// Path containment: never delete outside the sample directory even if an
	// input component contains a traversal sequence (e.g. a '..' study name).
	cleanTarget := filepath.Clean(target)
	cleanSampleDir := filepath.Clean(r.sampleDir)
	if cleanTarget != cleanSampleDir && !strings.HasPrefix(cleanTarget, cleanSampleDir+string(filepath.Separator)) {
		r.fs.logger.WithFields(logrus.Fields{
			"target":     cleanTarget,
			"sample_dir": cleanSampleDir,
		}).Error("refusing to remove job sample directory outside sample dir")
		return fmt.Errorf("path traversal detected: %s", cleanTarget)
	}

	if err := os.RemoveAll(cleanTarget); err != nil {
		r.fs.logger.WithFields(logrus.Fields{
			"target": cleanTarget,
			"error":  err.Error(),
		}).Error("failed to remove job sample directory")
		return fmt.Errorf("removing job sample directory %s: %w", cleanTarget, err)
	}
	r.fs.logger.WithField("target", cleanTarget).Info("job sample directory removed")
	return nil
}

// SampleDirCleaner removes study-generated sample directories from the
// sample directory root. It preserves directories whose names end in
// ".safetensors" (checkpoint fixture directories) and removes everything
// else (study-scoped directories created by the job executor during E2E
// tests). This is used by the test reset endpoint to prevent filesystem
// state from leaking between E2E tests.
type SampleDirCleaner struct {
	fs        *FileSystem
	sampleDir string
}

// NewSampleDirCleaner creates a SampleDirCleaner for the given sample directory.
func NewSampleDirCleaner(fs *FileSystem, sampleDir string) *SampleDirCleaner {
	return &SampleDirCleaner{fs: fs, sampleDir: sampleDir}
}

// CleanStudyDirs removes non-safetensors directories from the sample_dir root.
// These are study-scoped sample directories created during E2E tests.
// Checkpoint fixture directories (*.safetensors) and regular files are preserved.
func (c *SampleDirCleaner) CleanStudyDirs() error {
	c.fs.logger.WithField("sample_dir", c.sampleDir).Info("cleaning study-generated sample directories")

	entries, err := os.ReadDir(c.sampleDir)
	if err != nil {
		if os.IsNotExist(err) {
			c.fs.logger.Debug("sample directory does not exist, nothing to clean")
			return nil
		}
		return fmt.Errorf("reading sample directory %s: %w", c.sampleDir, err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		// Preserve checkpoint directories (*.safetensors)
		if strings.HasSuffix(strings.ToLower(entry.Name()), ".safetensors") {
			continue
		}
		// Remove study-generated directories
		target := filepath.Join(c.sampleDir, entry.Name())
		c.fs.logger.WithField("target", target).Info("removing study-generated sample directory")
		if err := os.RemoveAll(target); err != nil {
			return fmt.Errorf("removing study directory %s: %w", target, err)
		}
	}

	c.fs.logger.Info("study-generated sample directories cleaned")
	return nil
}

// OpenImageFile resolves relPath against sampleRoot with path-traversal
// protection, then opens the resolved regular file for streaming. relPath is a
// slash-separated path relative to sampleRoot (as supplied by the API client).
//
// It returns:
//   - ErrInvalidImagePath if relPath is empty, absolute, contains "." / ".."
//     components, or resolves outside sampleRoot.
//   - ErrImageNotFound if the resolved path does not exist or is a directory.
//
// On success the returned *ImageFile is positioned at the start of the file and
// the caller owns closing it.
func (fs *FileSystem) OpenImageFile(sampleRoot string, relPath string) (*ImageFile, error) {
	fs.logger.WithField("relative_path", relPath).Trace("entering OpenImageFile")
	defer fs.logger.Trace("returning from OpenImageFile")

	// Validate the path doesn't contain traversal components.
	if !isImagePathSafe(relPath) {
		fs.logger.WithField("relative_path", relPath).Warn("invalid image path rejected")
		return nil, ErrInvalidImagePath
	}

	absPath := filepath.Join(sampleRoot, filepath.FromSlash(relPath))

	// Double-check the resolved path is within sampleRoot using a
	// separator-bounded prefix check (S-154) so that a sibling directory whose
	// name shares a prefix (e.g. "samples-evil" vs "samples") is not accepted.
	cleanRoot := filepath.Clean(sampleRoot)
	cleanPath := filepath.Clean(absPath)
	if !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) && cleanPath != cleanRoot {
		fs.logger.WithField("relative_path", relPath).Warn("image path traversal attempt rejected")
		return nil, ErrInvalidImagePath
	}

	// Check the file exists and is a regular file.
	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		fs.logger.WithFields(logrus.Fields{
			"relative_path": relPath,
			"error":         err,
		}).Debug("image not found")
		return nil, ErrImageNotFound
	}

	// Open the file for streaming.
	file, err := os.Open(absPath)
	if err != nil {
		fs.logger.WithFields(logrus.Fields{
			"relative_path": relPath,
			"error":         err.Error(),
		}).Error("error opening image file")
		return nil, ErrImageNotFound
	}

	return &ImageFile{ReadSeekCloser: file, Size: info.Size()}, nil
}

// isImagePathSafe checks that a relative path does not contain path traversal
// components. This is the filesystem-layer port of the previous api-layer
// isPathSafe used for image serving.
func isImagePathSafe(p string) bool {
	// Reject empty paths.
	if p == "" {
		return false
	}

	// Reject absolute paths.
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") {
		return false
	}

	// Reject any "." or ".." components.
	parts := strings.Split(filepath.ToSlash(p), "/")
	for _, part := range parts {
		if part == ".." || part == "." {
			return false
		}
	}

	return true
}

// OpenFile opens a file for reading. Implements service.CheckpointMetadataReader.
func (fs *FileSystem) OpenFile(path string) (io.ReadCloser, error) {
	fs.logger.WithField("path", path).Trace("entering OpenFile")
	defer fs.logger.Trace("returning from OpenFile")

	fs.logger.WithField("path", path).Debug("opening file")
	file, err := os.Open(path)
	if err != nil {
		fields := logrus.Fields{
			"path":  path,
			"error": err.Error(),
		}
		if os.IsNotExist(err) {
			fs.logger.WithFields(fields).Debug("file not found")
		} else {
			fs.logger.WithFields(fields).Error("failed to open file")
		}
		return nil, err
	}
	return file, nil
}
