package service

import (
	"bytes"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png" // register PNG decoder
	"path/filepath"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// ThumbnailSubdir is the subdirectory name within each checkpoint sample directory
// where thumbnails are stored.
const ThumbnailSubdir = "thumbnails"

// ThumbnailGenerator generates JPEG thumbnails from PNG source images.
type ThumbnailGenerator struct {
	cfg    model.ThumbnailConfig
	logger *logrus.Entry
}

// NewThumbnailGenerator creates a new ThumbnailGenerator.
func NewThumbnailGenerator(cfg model.ThumbnailConfig, logger *logrus.Logger) *ThumbnailGenerator {
	return &ThumbnailGenerator{
		cfg:    cfg,
		logger: logger.WithField("component", "thumbnail_generator"),
	}
}

// ThumbnailPath returns the path where the thumbnail for the given source image
// would be stored. The thumbnail is placed in a "thumbnails/" subdirectory of
// the source image's parent directory, with a .jpg extension.
//
// Example:
//
//	source:    /data/samples/run/study/ckpt.safetensors/image.png
//	thumbnail: /data/samples/run/study/ckpt.safetensors/thumbnails/image.jpg
func ThumbnailPath(sourcePath string) string {
	dir := filepath.Dir(sourcePath)
	base := filepath.Base(sourcePath)
	// Replace the extension with .jpg
	ext := filepath.Ext(base)
	nameWithoutExt := base[:len(base)-len(ext)]
	thumbFilename := nameWithoutExt + ".jpg"
	return filepath.Join(dir, ThumbnailSubdir, thumbFilename)
}

// ThumbnailRelativePath returns the relative path (within sample_dir) for a thumbnail,
// given the relative path of the source image.
//
// Example:
//
//	source relative:    run/study/ckpt.safetensors/image.png
//	thumbnail relative: run/study/ckpt.safetensors/thumbnails/image.jpg
func ThumbnailRelativePath(sourceRelPath string) string {
	// Convert OS path to forward-slash path for manipulation
	dir := filepath.Dir(sourceRelPath)
	base := filepath.Base(sourceRelPath)
	ext := filepath.Ext(base)
	nameWithoutExt := base[:len(base)-len(ext)]
	thumbFilename := nameWithoutExt + ".jpg"
	// Use forward slashes for URL-safe relative paths
	thumbDir := filepath.ToSlash(dir) + "/" + ThumbnailSubdir
	return thumbDir + "/" + thumbFilename
}

// Generate creates a JPEG thumbnail from the PNG image data.
// Returns the thumbnail data as a byte slice.
func (g *ThumbnailGenerator) Generate(imageData []byte) ([]byte, error) {
	// Decode the source image
	src, _, err := image.Decode(bytes.NewReader(imageData))
	if err != nil {
		return nil, fmt.Errorf("decoding source image: %w", err)
	}

	// Compute thumbnail dimensions preserving aspect ratio
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()

	thumbW, thumbH := computeThumbnailDimensions(srcW, srcH, g.cfg.MaxResolutionX, g.cfg.MaxResolutionY)

	// If the thumbnail would be the same size as the source, just encode as JPEG
	if thumbW == srcW && thumbH == srcH {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: g.cfg.JPEGQuality}); err != nil {
			return nil, fmt.Errorf("encoding JPEG: %w", err)
		}
		return buf.Bytes(), nil
	}

	// Resize using bilinear interpolation
	resized := resizeBilinear(src, thumbW, thumbH)

	// Encode as JPEG
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, resized, &jpeg.Options{Quality: g.cfg.JPEGQuality}); err != nil {
		return nil, fmt.Errorf("encoding JPEG thumbnail: %w", err)
	}

	g.logger.WithFields(logrus.Fields{
		"src_w":   srcW,
		"src_h":   srcH,
		"thumb_w": thumbW,
		"thumb_h": thumbH,
		"quality": g.cfg.JPEGQuality,
		"size_kb": len(buf.Bytes()) / 1024,
	}).Debug("thumbnail generated")

	return buf.Bytes(), nil
}

// GenerateAndSave creates a thumbnail for the given source image path and writes it to disk.
// The thumbnail is stored in a "thumbnails/" subdirectory alongside the source image.
// Non-fatal: errors are logged but do not fail the caller.
func (g *ThumbnailGenerator) GenerateAndSave(sourcePath string, imageData []byte, fsWriter FileSystemWriter) error {
	thumbPath := ThumbnailPath(sourcePath)
	thumbDir := filepath.Dir(thumbPath)

	// Ensure thumbnail directory exists
	if err := fsWriter.MkdirAll(thumbDir, 0755); err != nil {
		return fmt.Errorf("creating thumbnail directory %q: %w", thumbDir, err)
	}

	// Generate thumbnail
	thumbData, err := g.Generate(imageData)
	if err != nil {
		return fmt.Errorf("generating thumbnail for %q: %w", sourcePath, err)
	}

	// Write thumbnail file
	if err := fsWriter.WriteFile(thumbPath, thumbData, 0644); err != nil {
		return fmt.Errorf("writing thumbnail to %q: %w", thumbPath, err)
	}

	g.logger.WithFields(logrus.Fields{
		"source_path": sourcePath,
		"thumb_path":  thumbPath,
		"size_bytes":  len(thumbData),
	}).Info("thumbnail saved")

	return nil
}

// computeThumbnailDimensions calculates the target thumbnail dimensions while
// preserving the aspect ratio and not exceeding maxW x maxH.
func computeThumbnailDimensions(srcW, srcH, maxW, maxH int) (int, int) {
	if srcW <= maxW && srcH <= maxH {
		// No scaling needed
		return srcW, srcH
	}

	// Compute the scale factor that fits within both maxW and maxH
	scaleX := float64(maxW) / float64(srcW)
	scaleY := float64(maxH) / float64(srcH)
	scale := scaleX
	if scaleY < scale {
		scale = scaleY
	}

	w := int(float64(srcW) * scale)
	h := int(float64(srcH) * scale)
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	return w, h
}

// resizeBilinear resizes an image to the target dimensions using bilinear interpolation.
func resizeBilinear(src image.Image, targetW, targetH int) image.Image {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()

	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))

	for dstY := 0; dstY < targetH; dstY++ {
		// Map destination Y to source coordinate (center of pixel)
		srcYF := (float64(dstY)+0.5)*float64(srcH)/float64(targetH) - 0.5
		y0 := int(srcYF)
		y1 := y0 + 1
		if y0 < 0 {
			y0 = 0
		}
		if y1 >= srcH {
			y1 = srcH - 1
		}
		dy := srcYF - float64(y0)

		for dstX := 0; dstX < targetW; dstX++ {
			// Map destination X to source coordinate
			srcXF := (float64(dstX)+0.5)*float64(srcW)/float64(targetW) - 0.5
			x0 := int(srcXF)
			x1 := x0 + 1
			if x0 < 0 {
				x0 = 0
			}
			if x1 >= srcW {
				x1 = srcW - 1
			}
			dx := srcXF - float64(x0)

			// Sample the four neighboring pixels
			c00r, c00g, c00b, c00a := src.At(bounds.Min.X+x0, bounds.Min.Y+y0).RGBA()
			c10r, c10g, c10b, c10a := src.At(bounds.Min.X+x1, bounds.Min.Y+y0).RGBA()
			c01r, c01g, c01b, c01a := src.At(bounds.Min.X+x0, bounds.Min.Y+y1).RGBA()
			c11r, c11g, c11b, c11a := src.At(bounds.Min.X+x1, bounds.Min.Y+y1).RGBA()

			// Bilinear interpolation (values are 0..65535 from RGBA())
			r := bilinear(c00r, c10r, c01r, c11r, dx, dy)
			greenVal := bilinear(c00g, c10g, c01g, c11g, dx, dy)
			b := bilinear(c00b, c10b, c01b, c11b, dx, dy)
			a := bilinear(c00a, c10a, c01a, c11a, dx, dy)

			// Store as 8-bit per channel in RGBA
			dst.Pix[(dstY*targetW+dstX)*4+0] = uint8(r >> 8)
			dst.Pix[(dstY*targetW+dstX)*4+1] = uint8(greenVal >> 8)
			dst.Pix[(dstY*targetW+dstX)*4+2] = uint8(b >> 8)
			dst.Pix[(dstY*targetW+dstX)*4+3] = uint8(a >> 8)
		}
	}

	return dst
}

// bilinear performs bilinear interpolation on four uint32 color component values.
// The values are in range [0, 65535] (from image.Color.RGBA()).
func bilinear(c00, c10, c01, c11 uint32, dx, dy float64) uint32 {
	top := float64(c00)*(1-dx) + float64(c10)*dx
	bot := float64(c01)*(1-dx) + float64(c11)*dx
	result := top*(1-dy) + bot*dy
	if result < 0 {
		return 0
	}
	if result > 65535 {
		return 65535
	}
	return uint32(result)
}

// ThumbnailExists returns true if a thumbnail already exists for the given source path.
func ThumbnailExists(sourcePath string, fsWriter FileSystemWriter) bool {
	thumbPath := ThumbnailPath(sourcePath)
	_, err := fsWriter.Stat(thumbPath)
	return err == nil
}

// ThumbnailRelativePathFromCheckpointDir computes the relative path of a thumbnail
// given the relative path of the source image (relative to sample_dir).
// The thumbnail filename replaces the original extension with .jpg and is placed
// in a "thumbnails/" subdirectory.
//
// This is the URL-safe version for API responses.
func ThumbnailRelativePathURLSafe(sourceRelPath string) string {
	// Normalise to forward-slash
	normalized := filepath.ToSlash(sourceRelPath)
	lastSlash := strings.LastIndex(normalized, "/")
	var dir, filename string
	if lastSlash < 0 {
		dir = ""
		filename = normalized
	} else {
		dir = normalized[:lastSlash]
		filename = normalized[lastSlash+1:]
	}

	ext := filepath.Ext(filename)
	nameWithoutExt := filename[:len(filename)-len(ext)]
	thumbFilename := nameWithoutExt + ".jpg"

	if dir == "" {
		return ThumbnailSubdir + "/" + thumbFilename
	}
	return dir + "/" + ThumbnailSubdir + "/" + thumbFilename
}
