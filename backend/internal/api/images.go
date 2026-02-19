package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// ImageHandler serves image files from the dataset root with path traversal
// protection and immutable cache headers.
type ImageHandler struct {
	root string
}

// NewImageHandler creates a handler that serves images from the given root directory.
func NewImageHandler(root string) *ImageHandler {
	return &ImageHandler{root: root}
}

// ServeHTTP handles GET /api/images/{filepath} requests.
func (h *ImageHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Extract the filepath from the URL path after /api/images/
	const prefix = "/api/images/"
	if !strings.HasPrefix(r.URL.Path, prefix) {
		http.Error(w, `{"message":"invalid path"}`, http.StatusBadRequest)
		return
	}
	reqPath := strings.TrimPrefix(r.URL.Path, prefix)

	if reqPath == "" {
		http.Error(w, `{"message":"filepath is required"}`, http.StatusBadRequest)
		return
	}

	// Validate the path doesn't contain traversal components
	if !isPathSafe(reqPath) {
		http.Error(w, `{"message":"invalid file path"}`, http.StatusBadRequest)
		return
	}

	absPath := filepath.Join(h.root, filepath.FromSlash(reqPath))

	// Double-check the resolved path is within root
	cleanRoot := filepath.Clean(h.root)
	cleanPath := filepath.Clean(absPath)
	if !strings.HasPrefix(cleanPath, cleanRoot+string(filepath.Separator)) && cleanPath != cleanRoot {
		http.Error(w, `{"message":"invalid file path"}`, http.StatusBadRequest)
		return
	}

	// Check file exists and is a regular file
	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		http.Error(w, `{"message":"image not found"}`, http.StatusNotFound)
		return
	}

	// Set cache headers before serving
	w.Header().Set("Cache-Control", "max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/png")

	http.ServeFile(w, r, absPath)
}

// isPathSafe checks that a relative path does not contain path traversal components.
func isPathSafe(p string) bool {
	// Reject empty paths
	if p == "" {
		return false
	}

	// Reject absolute paths
	if filepath.IsAbs(p) || strings.HasPrefix(p, "/") {
		return false
	}

	// Check each component
	parts := strings.Split(filepath.ToSlash(p), "/")
	for _, part := range parts {
		if part == ".." || part == "." {
			return false
		}
	}

	return true
}
