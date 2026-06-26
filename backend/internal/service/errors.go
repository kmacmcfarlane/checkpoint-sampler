package service

import "errors"

// Sentinel errors for the service layer. Callers (notably the API transport
// layer) must classify failures with errors.Is/errors.As against these
// sentinels rather than matching error message substrings (DEVELOPMENT_PRACTICES
// §3.2). Service methods wrap their failures with fmt.Errorf("...: %w", ErrXxx)
// so the sentinel survives wrapping and remains detectable at the boundary.
var (
	// ErrNotFound indicates a requested entity (preset, sample job, study,
	// training run, checkpoint file, image, workflow, ...) does not exist.
	ErrNotFound = errors.New("not found")

	// ErrInvalidFilename indicates a supplied filename failed safety validation
	// (e.g. contains path separators or traversal components).
	ErrInvalidFilename = errors.New("invalid filename")

	// ErrInvalidPath indicates a supplied relative path failed safety validation
	// (e.g. is absolute or contains traversal components).
	ErrInvalidPath = errors.New("invalid path")

	// ErrManifestNotFound indicates a job manifest.json file does not exist yet.
	// API callers use this to decide whether to fall back to count-based
	// validation. The sentinel never carries the absolute manifest path; the
	// path is logged server-side instead.
	ErrManifestNotFound = errors.New("manifest not found")

	// ErrServiceUnavailable indicates a dependency required to service the
	// request (e.g. the ComfyUI connection) is not available.
	ErrServiceUnavailable = errors.New("service unavailable")
)
