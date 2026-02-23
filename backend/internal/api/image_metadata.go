package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// ImageMetadataHandler serves PNG embedded metadata from the sample directory.
type ImageMetadataHandler struct {
	metadataSvc *service.ImageMetadataService
}

// NewImageMetadataHandler creates a handler that serves image metadata.
func NewImageMetadataHandler(metadataSvc *service.ImageMetadataService) *ImageMetadataHandler {
	return &ImageMetadataHandler{metadataSvc: metadataSvc}
}

// imageMetadataResponse is the JSON response for the image metadata endpoint.
type imageMetadataResponse struct {
	Metadata map[string]string `json:"metadata"`
}

// ServeHTTP handles GET /api/images/{filepath}/metadata requests.
// The filepath is extracted from the URL after the /api/images/ prefix,
// with the /metadata suffix stripped.
func (h *ImageMetadataHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	const prefix = "/api/images/"
	const suffix = "/metadata"

	if !strings.HasPrefix(r.URL.Path, prefix) {
		writeJSONError(w, "invalid path", http.StatusBadRequest)
		return
	}

	reqPath := strings.TrimPrefix(r.URL.Path, prefix)

	// The path should end with /metadata
	if !strings.HasSuffix(reqPath, suffix) {
		writeJSONError(w, "invalid path", http.StatusBadRequest)
		return
	}

	// Strip the /metadata suffix to get the actual image filepath
	imagePath := strings.TrimSuffix(reqPath, suffix)

	if imagePath == "" {
		writeJSONError(w, "filepath is required", http.StatusBadRequest)
		return
	}

	metadata, err := h.metadataSvc.GetMetadata(imagePath)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "invalid path") {
			writeJSONError(w, "invalid file path", http.StatusBadRequest)
			return
		}
		if strings.Contains(errMsg, "opening file") {
			writeJSONError(w, "image not found", http.StatusNotFound)
			return
		}
		writeJSONError(w, "image not found", http.StatusNotFound)
		return
	}

	if metadata == nil {
		metadata = map[string]string{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(imageMetadataResponse{Metadata: metadata})
}

func writeJSONError(w http.ResponseWriter, message string, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"message": message})
}
