package api_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// buildTestPNGWithTextChunks creates a minimal PNG file with the given tEXt chunks.
func buildTestPNGWithTextChunks(texts map[string]string) []byte {
	buf := new(bytes.Buffer)

	// PNG signature
	buf.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})

	// Minimal IHDR chunk (13 bytes)
	ihdr := new(bytes.Buffer)
	binary.Write(ihdr, binary.BigEndian, uint32(1)) // width
	binary.Write(ihdr, binary.BigEndian, uint32(1)) // height
	ihdr.WriteByte(8)                               // bit depth
	ihdr.WriteByte(2)                               // color type (RGB)
	ihdr.WriteByte(0)                               // compression
	ihdr.WriteByte(0)                               // filter
	ihdr.WriteByte(0)                               // interlace
	writeTestChunk(buf, "IHDR", ihdr.Bytes())

	// tEXt chunks
	for key, value := range texts {
		data := append([]byte(key), 0)
		data = append(data, []byte(value)...)
		writeTestChunk(buf, "tEXt", data)
	}

	// IEND chunk
	writeTestChunk(buf, "IEND", nil)

	return buf.Bytes()
}

// buildTestMinimalPNG creates a minimal valid PNG with no tEXt chunks.
func buildTestMinimalPNG() []byte {
	return buildTestPNGWithTextChunks(nil)
}

// writeTestChunk writes a PNG chunk (length + type + data + CRC).
func writeTestChunk(buf *bytes.Buffer, chunkType string, data []byte) {
	binary.Write(buf, binary.BigEndian, uint32(len(data)))
	buf.WriteString(chunkType)
	if len(data) > 0 {
		buf.Write(data)
	}
	// Write a placeholder CRC (not validated by our parser)
	binary.Write(buf, binary.BigEndian, uint32(0))
}

var _ = Describe("ImagesService", func() {
	var (
		sampleDir string
		logger    *logrus.Logger
		svc       *api.ImagesService
	)

	BeforeEach(func() {
		var err error
		sampleDir, err = os.MkdirTemp("", "images-service-test-*")
		Expect(err).NotTo(HaveOccurred())
		logger = logrus.New()
		logger.SetOutput(io.Discard)

		fs := &realFileReader{}
		metadataSvc := service.NewImageMetadataService(fs, sampleDir, logger)
		svc = api.NewImagesService(sampleDir, metadataSvc, logger)
	})

	AfterEach(func() {
		os.RemoveAll(sampleDir)
	})

	Describe("Download", func() {
		It("successfully downloads an image file", func() {
			// Create a subdirectory with a test image
			subDir := filepath.Join(sampleDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			// Write a minimal PNG file
			pngData := buildTestMinimalPNG()
			imagePath := filepath.Join(subDir, "test.png")
			Expect(os.WriteFile(imagePath, pngData, 0644)).To(Succeed())

			result, body, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "checkpoint.safetensors/test.png",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeNil())
			Expect(result.ContentType).To(Equal("image/png"))
			Expect(result.ContentLength).To(Equal(int64(len(pngData))))
			Expect(result.CacheControl).To(Equal("max-age=31536000, immutable"))

			// Read the body and verify it matches the original data
			Expect(body).NotTo(BeNil())
			defer body.Close()
			readData, err := io.ReadAll(body)
			Expect(err).NotTo(HaveOccurred())
			Expect(readData).To(Equal(pngData))
		})

		It("detects content type correctly for different image types", func() {
			// Create a JPEG-like file
			jpegHeader := []byte{0xFF, 0xD8, 0xFF}
			imagePath := filepath.Join(sampleDir, "test.jpg")
			Expect(os.WriteFile(imagePath, jpegHeader, 0644)).To(Succeed())

			result, body, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "test.jpg",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.ContentType).To(ContainSubstring("image"))
			body.Close()
		})

		It("returns not_found error for nonexistent image", func() {
			_, _, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "nonexistent/image.png",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns bad_request error for path traversal with ..", func() {
			_, _, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "../etc/passwd",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid file path"))
		})

		It("returns bad_request error for absolute path", func() {
			_, _, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "/etc/passwd",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid file path"))
		})

		It("returns bad_request error for empty filepath", func() {
			_, _, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid file path"))
		})

		It("returns not_found error when filepath is a directory", func() {
			// Create a directory
			dirPath := filepath.Join(sampleDir, "some_dir")
			Expect(os.MkdirAll(dirPath, 0755)).To(Succeed())

			_, _, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "some_dir",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("rejects path with . component", func() {
			_, _, err := svc.Download(context.Background(), &genimages.DownloadPayload{
				Filepath: "./image.png",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid file path"))
		})
	})

	Describe("Metadata", func() {
		It("returns metadata from PNG tEXt chunks", func() {
			// Create a PNG with tEXt chunks
			subDir := filepath.Join(sampleDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			pngData := buildTestPNGWithTextChunks(map[string]string{
				"prompt":   `{"3": {"class_type": "KSampler"}}`,
				"workflow": `{"nodes": []}`,
			})
			imagePath := filepath.Join(subDir, "image.png")
			Expect(os.WriteFile(imagePath, pngData, 0644)).To(Succeed())

			result, err := svc.Metadata(context.Background(), &genimages.MetadataPayload{
				Filepath: "checkpoint.safetensors/image.png",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result).NotTo(BeNil())
			Expect(result.Metadata).To(HaveLen(2))
			Expect(result.Metadata["prompt"]).To(Equal(`{"3": {"class_type": "KSampler"}}`))
			Expect(result.Metadata["workflow"]).To(Equal(`{"nodes": []}`))
		})

		It("returns empty metadata for PNG without tEXt chunks", func() {
			pngData := buildTestMinimalPNG()
			imagePath := filepath.Join(sampleDir, "image.png")
			Expect(os.WriteFile(imagePath, pngData, 0644)).To(Succeed())

			result, err := svc.Metadata(context.Background(), &genimages.MetadataPayload{
				Filepath: "image.png",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Metadata).To(BeEmpty())
		})

		It("returns not_found error for nonexistent image", func() {
			_, err := svc.Metadata(context.Background(), &genimages.MetadataPayload{
				Filepath: "nonexistent/image.png",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("returns bad_request error for path traversal attempt", func() {
			_, err := svc.Metadata(context.Background(), &genimages.MetadataPayload{
				Filepath: "../etc/passwd",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid file path"))
		})

		It("returns bad_request error for absolute path", func() {
			_, err := svc.Metadata(context.Background(), &genimages.MetadataPayload{
				Filepath: "/etc/passwd",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid file path"))
		})
	})
})
