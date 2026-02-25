package service

import (
	"os"
)

// fileInfo abstracts os.FileInfo for testing
type fileInfo interface {
	IsDir() bool
}

// FileSystemWriter defines the interface for filesystem operations.
type FileSystemWriter interface {
	MkdirAll(path string, perm uint32) error
	WriteFile(path string, data []byte, perm uint32) error
	Stat(path string) (fileInfo, error)
	RenameFile(oldPath, newPath string) error
}

// RealFileSystemWriter provides real filesystem operations.
type RealFileSystemWriter struct{}

// MkdirAll creates a directory tree.
func (r *RealFileSystemWriter) MkdirAll(path string, perm uint32) error {
	return os.MkdirAll(path, os.FileMode(perm))
}

// WriteFile writes data to a file.
func (r *RealFileSystemWriter) WriteFile(path string, data []byte, perm uint32) error {
	return os.WriteFile(path, data, os.FileMode(perm))
}

// Stat returns file information.
func (r *RealFileSystemWriter) Stat(path string) (fileInfo, error) {
	return os.Stat(path)
}

// RenameFile atomically renames oldPath to newPath.
func (r *RealFileSystemWriter) RenameFile(oldPath, newPath string) error {
	return os.Rename(oldPath, newPath)
}
