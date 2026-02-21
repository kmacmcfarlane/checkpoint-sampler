package store

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// FileSystem provides filesystem operations for scanning directories and images.
type FileSystem struct{}

// NewFileSystem creates a new FileSystem store.
func NewFileSystem() *FileSystem {
	return &FileSystem{}
}

// ListSafetensorsFiles recursively scans root for .safetensors files and returns
// their paths relative to root.
func (fs *FileSystem) ListSafetensorsFiles(root string) ([]string, error) {
	var files []string

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
		return nil, fmt.Errorf("scanning for safetensors files: %w", err)
	}

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
	entries, err := os.ReadDir(dir)
	if err != nil {
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
	return files, nil
}

// OpenFile opens a file for reading. Implements service.CheckpointMetadataReader.
func (fs *FileSystem) OpenFile(path string) (io.ReadCloser, error) {
	return os.Open(path)
}
