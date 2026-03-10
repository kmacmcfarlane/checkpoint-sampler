// Thumbnail tests are in the service package to access unexported types.
package service

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// makePNGBytes creates a minimal PNG image of the given dimensions, filled with red.
func makePNGBytes(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{R: 200, G: 100, B: 50, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		panic(err)
	}
	return buf.Bytes()
}

// thumbnailFakeWriter is a simple in-memory FileSystemWriter for testing thumbnails.
type thumbnailFakeWriter struct {
	dirs  map[string]bool
	files map[string][]byte
}

func newThumbnailFakeWriter() *thumbnailFakeWriter {
	return &thumbnailFakeWriter{
		dirs:  make(map[string]bool),
		files: make(map[string][]byte),
	}
}

func (w *thumbnailFakeWriter) MkdirAll(path string, _ uint32) error {
	w.dirs[path] = true
	return nil
}

func (w *thumbnailFakeWriter) WriteFile(path string, data []byte, _ uint32) error {
	w.files[path] = data
	return nil
}

func (w *thumbnailFakeWriter) Stat(path string) (fileInfo, error) {
	if _, ok := w.files[path]; ok {
		return &osStatResult{isDir: false}, nil
	}
	if _, ok := w.dirs[path]; ok {
		return &osStatResult{isDir: true}, nil
	}
	return nil, os.ErrNotExist
}

func (w *thumbnailFakeWriter) RenameFile(_, _ string) error {
	return nil
}

type osStatResult struct{ isDir bool }

func (s *osStatResult) IsDir() bool { return s.isDir }

var _ = Describe("ThumbnailGenerator", func() {
	var (
		cfg    model.ThumbnailConfig
		logger *logrus.Logger
		gen    *ThumbnailGenerator
	)

	BeforeEach(func() {
		cfg = model.ThumbnailConfig{
			Enabled:        true,
			MaxResolutionX: 256,
			MaxResolutionY: 256,
			JPEGQuality:    85,
		}
		logger = logrus.New()
		logger.SetOutput(io.Discard)
		gen = NewThumbnailGenerator(cfg, logger)
	})

	Describe("Generate", func() {
		It("produces JPEG output smaller than the original PNG", func() {
			// AC: Generate JPEG thumbnails during sample creation when enabled in config
			src := makePNGBytes(512, 512)
			thumb, err := gen.Generate(src)
			Expect(err).NotTo(HaveOccurred())
			Expect(thumb).NotTo(BeEmpty())
			// JPEG should generally be smaller than the PNG source
			Expect(len(thumb)).To(BeNumerically("<", len(src)))
		})

		It("produces output within the configured max resolution", func() {
			// AC: Thumbnail settings (max_resolution_x, max_resolution_y) respected
			src := makePNGBytes(1344, 1344)
			thumb, err := gen.Generate(src)
			Expect(err).NotTo(HaveOccurred())

			// Decode the JPEG to check dimensions
			decoded, _, decErr := image.Decode(bytes.NewReader(thumb))
			Expect(decErr).NotTo(HaveOccurred())

			bounds := decoded.Bounds()
			Expect(bounds.Dx()).To(BeNumerically("<=", 256))
			Expect(bounds.Dy()).To(BeNumerically("<=", 256))
		})

		It("preserves aspect ratio", func() {
			// Source is 1344 wide × 672 tall (2:1 aspect ratio)
			src := makePNGBytes(1344, 672)
			thumb, err := gen.Generate(src)
			Expect(err).NotTo(HaveOccurred())

			decoded, _, decErr := image.Decode(bytes.NewReader(thumb))
			Expect(decErr).NotTo(HaveOccurred())

			bounds := decoded.Bounds()
			// Width should be at most maxX (256), height should be at most maxY (256)
			Expect(bounds.Dx()).To(BeNumerically("<=", 256))
			Expect(bounds.Dy()).To(BeNumerically("<=", 256))
			// Width should be approximately 2× height (aspect ratio preserved)
			ratio := float64(bounds.Dx()) / float64(bounds.Dy())
			Expect(ratio).To(BeNumerically("~", 2.0, 0.2))
		})

		It("does not upscale small images", func() {
			// Source is 64x64, smaller than max 256x256 — should stay 64x64
			src := makePNGBytes(64, 64)
			thumb, err := gen.Generate(src)
			Expect(err).NotTo(HaveOccurred())

			decoded, _, decErr := image.Decode(bytes.NewReader(thumb))
			Expect(decErr).NotTo(HaveOccurred())

			bounds := decoded.Bounds()
			Expect(bounds.Dx()).To(Equal(64))
			Expect(bounds.Dy()).To(Equal(64))
		})

		It("returns an error for invalid image data", func() {
			_, err := gen.Generate([]byte("not an image"))
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("GenerateAndSave", func() {
		It("writes the thumbnail to the thumbnails subdirectory", func() {
			// AC: Thumbnails stored in subdir of each checkpoint's sample directory
			writer := newThumbnailFakeWriter()
			src := makePNGBytes(512, 512)

			sourcePath := "/data/samples/run/study/ckpt.safetensors/image.png"
			err := gen.GenerateAndSave(sourcePath, src, writer)
			Expect(err).NotTo(HaveOccurred())

			expectedDir := "/data/samples/run/study/ckpt.safetensors/" + ThumbnailSubdir
			expectedPath := expectedDir + "/image.jpg"

			Expect(writer.dirs).To(HaveKey(expectedDir))
			Expect(writer.files).To(HaveKey(expectedPath))
		})
	})

	Describe("ThumbnailPath", func() {
		It("replaces extension with .jpg and adds thumbnails subdir", func() {
			// AC: Thumbnails stored in subdir of each checkpoint's sample directory
			sourcePath := "/data/samples/ckpt.safetensors/image.png"
			thumbPath := ThumbnailPath(sourcePath)
			Expect(thumbPath).To(Equal(filepath.Join("/data/samples/ckpt.safetensors", ThumbnailSubdir, "image.jpg")))
		})
	})

	Describe("ThumbnailRelativePathURLSafe", func() {
		It("returns a forward-slash relative path", func() {
			relPath := "study/ckpt.safetensors/image.png"
			thumbRel := ThumbnailRelativePathURLSafe(relPath)
			Expect(thumbRel).To(Equal("study/ckpt.safetensors/" + ThumbnailSubdir + "/image.jpg"))
		})

		It("handles root-level images (no parent dir)", func() {
			relPath := "image.png"
			thumbRel := ThumbnailRelativePathURLSafe(relPath)
			Expect(thumbRel).To(Equal(ThumbnailSubdir + "/image.jpg"))
		})
	})
})

var _ = Describe("computeThumbnailDimensions", func() {
	DescribeTable("returns correct dimensions",
		func(srcW, srcH, maxW, maxH, expectedW, expectedH int) {
			w, h := computeThumbnailDimensions(srcW, srcH, maxW, maxH)
			Expect(w).To(Equal(expectedW))
			Expect(h).To(Equal(expectedH))
		},
		Entry("no scaling needed when within bounds", 100, 100, 256, 256, 100, 100),
		Entry("scales down uniformly (square)", 512, 512, 256, 256, 256, 256),
		Entry("scales by width constraint (landscape)", 512, 256, 256, 256, 256, 128),
		Entry("scales by height constraint (portrait)", 256, 512, 256, 256, 128, 256),
		Entry("scales by width when both exceed max", 1344, 1344, 512, 512, 512, 512),
	)
})
