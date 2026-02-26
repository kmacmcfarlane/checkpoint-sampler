package store

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/sirupsen/logrus"
)

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
		fs.logger.WithFields(logrus.Fields{
			"root":  root,
			"error": err.Error(),
		}).Error("failed to scan for safetensors files")
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

// ListPNGFiles returns the names of .png files in the given directory.
// Only regular files with a .png extension (case-insensitive) are returned.
func (fs *FileSystem) ListPNGFiles(dir string) ([]string, error) {
	fs.logger.WithField("directory", dir).Trace("entering ListPNGFiles")
	defer fs.logger.Trace("returning from ListPNGFiles")

	fs.logger.WithField("directory", dir).Debug("reading directory for PNG files")
	entries, err := os.ReadDir(dir)
	if err != nil {
		fs.logger.WithFields(logrus.Fields{
			"directory": dir,
			"error":     err.Error(),
		}).Error("failed to read directory")
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

// CheckpointSampleDirRemover implements service.SampleDirRemover by removing per-checkpoint
// sample directories under a configured sample root directory.
type CheckpointSampleDirRemover struct {
	fs        *FileSystem
	sampleDir string
}

// NewCheckpointSampleDirRemover creates a CheckpointSampleDirRemover.
func NewCheckpointSampleDirRemover(fs *FileSystem, sampleDir string) *CheckpointSampleDirRemover {
	return &CheckpointSampleDirRemover{fs: fs, sampleDir: sampleDir}
}

// RemoveSampleDir removes sample_dir/checkpointFilename/ for the given checkpoint.
func (r *CheckpointSampleDirRemover) RemoveSampleDir(checkpointFilename string) error {
	return r.fs.RemoveSampleDir(r.sampleDir, checkpointFilename)
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
