package store

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// FileSystem provides filesystem operations for scanning directories and images.
type FileSystem struct{}

// NewFileSystem creates a new FileSystem store.
func NewFileSystem() *FileSystem {
	return &FileSystem{}
}

// ListDirectories walks the directory tree under root and returns relative
// paths of directories whose relative path matches the given pattern.
func (fs *FileSystem) ListDirectories(root string, pattern *regexp.Regexp) ([]string, error) {
	var dirs []string

	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		// Skip the root directory itself
		if relPath == "." {
			return nil
		}

		// Normalize to forward slashes for pattern matching
		relPath = filepath.ToSlash(relPath)

		if pattern.MatchString(relPath) {
			dirs = append(dirs, relPath)
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walking directory tree: %w", err)
	}

	return dirs, nil
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
