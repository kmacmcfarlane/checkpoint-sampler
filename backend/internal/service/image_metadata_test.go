package service_test

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// buildPNGWithTextChunks creates a minimal PNG file with the given tEXt chunks.
func buildPNGWithTextChunks(texts map[string]string) []byte {
	buf := new(bytes.Buffer)

	// PNG signature
	buf.Write([]byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A})

	// Minimal IHDR chunk (13 bytes)
	ihdr := new(bytes.Buffer)
	binary.Write(ihdr, binary.BigEndian, uint32(1))  // width
	binary.Write(ihdr, binary.BigEndian, uint32(1))  // height
	ihdr.WriteByte(8)                                 // bit depth
	ihdr.WriteByte(2)                                 // color type (RGB)
	ihdr.WriteByte(0)                                 // compression
	ihdr.WriteByte(0)                                 // filter
	ihdr.WriteByte(0)                                 // interlace
	writeChunk(buf, "IHDR", ihdr.Bytes())

	// tEXt chunks
	for key, value := range texts {
		data := append([]byte(key), 0)
		data = append(data, []byte(value)...)
		writeChunk(buf, "tEXt", data)
	}

	// IEND chunk
	writeChunk(buf, "IEND", nil)

	return buf.Bytes()
}

// buildMinimalPNG creates a minimal valid PNG with no tEXt chunks.
func buildMinimalPNG() []byte {
	return buildPNGWithTextChunks(nil)
}

// writeChunk writes a PNG chunk (length + type + data + CRC).
func writeChunk(buf *bytes.Buffer, chunkType string, data []byte) {
	binary.Write(buf, binary.BigEndian, uint32(len(data)))
	buf.WriteString(chunkType)
	if len(data) > 0 {
		buf.Write(data)
	}
	// Write a placeholder CRC (not validated by our parser)
	binary.Write(buf, binary.BigEndian, uint32(0))
}

var _ = Describe("ImageMetadataService", func() {
	var (
		tmpDir string
		svc    *service.ImageMetadataService
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "image-metadata-test-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	Describe("GetMetadata", func() {
		Context("with valid PNG files containing tEXt chunks", func() {
			It("extracts prompt and workflow metadata from tEXt chunks", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildPNGWithTextChunks(map[string]string{
					"prompt":   `{"3": {"class_type": "KSampler"}}`,
					"workflow": `{"nodes": []}`,
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(2))
				Expect(result["prompt"]).To(Equal(`{"3": {"class_type": "KSampler"}}`))
				Expect(result["workflow"]).To(Equal(`{"nodes": []}`))
			})

			It("returns empty map when PNG has no tEXt chunks", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildMinimalPNG()
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(BeEmpty())
			})

			It("extracts all tEXt chunk keys, not just prompt/workflow", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildPNGWithTextChunks(map[string]string{
					"prompt":   `{"nodes": []}`,
					"workflow": `{"workflow": true}`,
					"Comment":  "some comment",
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(3))
				Expect(result).To(HaveKey("prompt"))
				Expect(result).To(HaveKey("workflow"))
				Expect(result).To(HaveKey("Comment"))
			})

			It("handles PNG with only a prompt chunk", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildPNGWithTextChunks(map[string]string{
					"prompt": `{"sampler": "euler"}`,
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(1))
				Expect(result["prompt"]).To(Equal(`{"sampler": "euler"}`))
			})
		})

		Context("path validation", func() {
			BeforeEach(func() {
				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
			})

			It("rejects empty path", func() {
				_, err := svc.GetMetadata("")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid path"))
			})

			It("rejects absolute path", func() {
				_, err := svc.GetMetadata("/etc/passwd")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid path"))
			})

			It("rejects path with dot-dot traversal", func() {
				_, err := svc.GetMetadata("../etc/passwd")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid path"))
			})

			It("rejects path with single dot component", func() {
				_, err := svc.GetMetadata("./image.png")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid path"))
			})

			It("rejects path with embedded dot-dot", func() {
				_, err := svc.GetMetadata("checkpoint.safetensors/../../../etc/passwd")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid path"))
			})
		})

		Context("error handling", func() {
			It("returns error when file does not exist", func() {
				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)

				_, err := svc.GetMetadata("nonexistent/image.png")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("parsing PNG metadata"))
			})

			It("returns error for non-PNG file", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())
				Expect(os.WriteFile(filepath.Join(subDir, "notapng.png"), []byte("not a png file"), 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
				_, err := svc.GetMetadata("checkpoint.safetensors/notapng.png")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("not a PNG file"))
			})

			It("returns error for truncated PNG (only signature)", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())
				// Just the PNG signature, no chunks
				data := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
				Expect(os.WriteFile(filepath.Join(subDir, "truncated.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir)
				result, err := svc.GetMetadata("checkpoint.safetensors/truncated.png")

				// A truncated PNG after signature should return empty metadata (no chunks found)
				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(BeEmpty())
			})
		})
	})
})
