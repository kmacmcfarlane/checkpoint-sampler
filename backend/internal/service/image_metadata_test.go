package service_test

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// buildPNGWithTextChunks creates a minimal PNG file with the given tEXt chunks.
func buildPNGWithTextChunks(texts map[string]string) []byte {
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
		logger *logrus.Logger
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "image-metadata-test-*")
		Expect(err).NotTo(HaveOccurred())
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	Describe("GetMetadata", func() {
		Context("with valid PNG files containing tEXt chunks", func() {
			It("extracts prompt and workflow metadata from tEXt chunks into string fields", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildPNGWithTextChunks(map[string]string{
					"prompt":   `{"3": {"class_type": "KSampler"}}`,
					"workflow": `{"nodes": []}`,
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result.StringFields).To(HaveLen(2))
				Expect(result.NumericFields).To(BeEmpty())
				Expect(result.StringFields["prompt"]).To(Equal(`{"3": {"class_type": "KSampler"}}`))
				Expect(result.StringFields["workflow"]).To(Equal(`{"nodes": []}`))
			})

			It("returns empty fields when PNG has no tEXt chunks", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildMinimalPNG()
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result.StringFields).To(BeEmpty())
				Expect(result.NumericFields).To(BeEmpty())
			})

			It("extracts all tEXt chunk keys into string fields", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildPNGWithTextChunks(map[string]string{
					"prompt":   `{"nodes": []}`,
					"workflow": `{"workflow": true}`,
					"Comment":  "some comment",
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result.StringFields).To(HaveLen(3))
				Expect(result.StringFields).To(HaveKey("prompt"))
				Expect(result.StringFields).To(HaveKey("workflow"))
				Expect(result.StringFields).To(HaveKey("Comment"))
				Expect(result.NumericFields).To(BeEmpty())
			})

			It("handles PNG with only a prompt chunk", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				data := buildPNGWithTextChunks(map[string]string{
					"prompt": `{"sampler": "euler"}`,
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result.StringFields).To(HaveLen(1))
				Expect(result.StringFields["prompt"]).To(Equal(`{"sampler": "euler"}`))
				Expect(result.NumericFields).To(BeEmpty())
			})
		})

		Context("path validation", func() {
			BeforeEach(func() {
				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
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
				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)

				_, err := svc.GetMetadata("nonexistent/image.png")
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("parsing PNG metadata"))
			})

			It("returns error for non-PNG file", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())
				Expect(os.WriteFile(filepath.Join(subDir, "notapng.png"), []byte("not a png file"), 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
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

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/truncated.png")

				// A truncated PNG after signature should return empty metadata (no chunks found)
				Expect(err).NotTo(HaveOccurred())
				Expect(result.StringFields).To(BeEmpty())
				Expect(result.NumericFields).To(BeEmpty())
			})
		})

		Context("sidecar-first metadata reading", func() {
			It("reads metadata from JSON sidecar when present, ignoring PNG tEXt chunks", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				// Write PNG with tEXt metadata
				pngData := buildPNGWithTextChunks(map[string]string{
					"prompt": `{"nodes": []}`,
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), pngData, 0644)).To(Succeed())

				// Write sidecar JSON with different metadata
				sidecar := map[string]interface{}{
					"prompt_name":     "forest",
					"prompt_text":     "a dense forest at dawn",
					"seed":            420,
					"cfg":             1.0,
					"steps":           20,
					"sampler_name":    "euler",
					"scheduler":       "normal",
					"width":           1024,
					"height":          768,
					"negative_prompt": "blurry",
					"checkpoint":      "checkpoint.safetensors",
					"workflow_name":   "flux_dev.json",
					"job_id":          "job-1",
					"timestamp":       "2026-02-25T12:00:00Z",
				}
				sidecarData, err := json.Marshal(sidecar)
				Expect(err).NotTo(HaveOccurred())
				Expect(os.WriteFile(filepath.Join(subDir, "image.json"), sidecarData, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				// String fields from sidecar
				Expect(result.StringFields).To(HaveKeyWithValue("prompt_name", "forest"))
				Expect(result.StringFields).To(HaveKeyWithValue("prompt_text", "a dense forest at dawn"))
				Expect(result.StringFields).To(HaveKeyWithValue("negative_prompt", "blurry"))
				Expect(result.StringFields).To(HaveKeyWithValue("workflow_name", "flux_dev.json"))
				// Numeric fields: seed, steps, cfg, width, height
				Expect(result.NumericFields).To(HaveKey("seed"))
				Expect(result.NumericFields).To(HaveKey("steps"))
				Expect(result.NumericFields).To(HaveKey("cfg"))
				Expect(result.NumericFields).To(HaveKeyWithValue("width", BeNumerically("==", 1024)))
				Expect(result.NumericFields).To(HaveKeyWithValue("height", BeNumerically("==", 768)))
				// width and height must NOT appear in StringFields
				Expect(result.StringFields).NotTo(HaveKey("width"))
				Expect(result.StringFields).NotTo(HaveKey("height"))
				// PNG tEXt "prompt" key should NOT appear (we read sidecar, not PNG)
				Expect(result.StringFields).NotTo(HaveKey("prompt"))
			})

			It("falls back to PNG tEXt chunks when no sidecar exists", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				// Write PNG with tEXt metadata but NO sidecar
				pngData := buildPNGWithTextChunks(map[string]string{
					"prompt":   `{"nodes": []}`,
					"workflow": `{"nodes": []}`,
				})
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), pngData, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				// Should return PNG tEXt metadata in string fields when sidecar is absent
				Expect(result.StringFields).To(HaveKey("prompt"))
				Expect(result.StringFields).To(HaveKey("workflow"))
				Expect(result.NumericFields).To(BeEmpty())
			})

			It("returns typed numeric fields for seed, steps, cfg and string fields for others", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				// Write minimal PNG
				pngData := buildMinimalPNG()
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), pngData, 0644)).To(Succeed())

				// Write sidecar with numeric values
				sidecar := map[string]interface{}{
					"seed":   int64(12345),
					"steps":  20,
					"cfg":    7.5,
					"job_id": "job-42",
				}
				sidecarData, err := json.Marshal(sidecar)
				Expect(err).NotTo(HaveOccurred())
				Expect(os.WriteFile(filepath.Join(subDir, "image.json"), sidecarData, 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				// seed, steps, cfg go into NumericFields as float64
				Expect(result.NumericFields).To(HaveKeyWithValue("seed", BeNumerically("==", 12345)))
				Expect(result.NumericFields).To(HaveKeyWithValue("steps", BeNumerically("==", 20)))
				Expect(result.NumericFields).To(HaveKeyWithValue("cfg", BeNumerically("~", 7.5, 0.001)))
				// job_id goes into StringFields
				Expect(result.StringFields).To(HaveKeyWithValue("job_id", "job-42"))
			})

			It("returns empty fields when sidecar is empty JSON object", func() {
				subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
				Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

				pngData := buildMinimalPNG()
				Expect(os.WriteFile(filepath.Join(subDir, "image.png"), pngData, 0644)).To(Succeed())

				Expect(os.WriteFile(filepath.Join(subDir, "image.json"), []byte(`{}`), 0644)).To(Succeed())

				svc = service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
				result, err := svc.GetMetadata("checkpoint.safetensors/image.png")

				Expect(err).NotTo(HaveOccurred())
				Expect(result.StringFields).To(BeEmpty())
				Expect(result.NumericFields).To(BeEmpty())
			})
		})
	})

	// DescribeTable for sidecar field type routing: verifies that each known
	// numeric field (seed, steps, cfg) is routed to NumericFields and that
	// an unknown field is routed to StringFields.
	DescribeTable("sidecar field type routing",
		func(fieldName string, jsonValue interface{}, expectNumeric bool, expectedFloat float64, expectedString string) {
			subDir := filepath.Join(tmpDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			pngData := buildMinimalPNG()
			Expect(os.WriteFile(filepath.Join(subDir, "image.png"), pngData, 0644)).To(Succeed())

			sidecar := map[string]interface{}{fieldName: jsonValue}
			data, err := json.Marshal(sidecar)
			Expect(err).NotTo(HaveOccurred())
			Expect(os.WriteFile(filepath.Join(subDir, "image.json"), data, 0644)).To(Succeed())

			svcLocal := service.NewImageMetadataService(&realFileOpener{}, tmpDir, logger)
			result, err := svcLocal.GetMetadata("checkpoint.safetensors/image.png")

			Expect(err).NotTo(HaveOccurred())
			if expectNumeric {
				Expect(result.NumericFields).To(HaveKey(fieldName))
				Expect(result.NumericFields[fieldName]).To(BeNumerically("~", expectedFloat, 0.001))
				Expect(result.StringFields).NotTo(HaveKey(fieldName))
			} else {
				Expect(result.StringFields).To(HaveKeyWithValue(fieldName, expectedString))
				Expect(result.NumericFields).NotTo(HaveKey(fieldName))
			}
		},
		Entry("seed is numeric", "seed", 42, true, 42.0, ""),
		Entry("steps is numeric", "steps", 20, true, 20.0, ""),
		Entry("cfg is numeric", "cfg", 7.5, true, 7.5, ""),
		Entry("width is numeric", "width", 1024, true, 1024.0, ""),
		Entry("height is numeric", "height", 768, true, 768.0, ""),
		Entry("index is numeric", "index", 3, true, 3.0, ""),
		Entry("prompt_name is string", "prompt_name", "forest", false, 0.0, "forest"),
		Entry("sampler_name is string", "sampler_name", "euler", false, 0.0, "euler"),
		Entry("workflow_name is string", "workflow_name", "flux.json", false, 0.0, "flux.json"),
		Entry("job_id is string", "job_id", "job-99", false, 0.0, "job-99"),
	)
})
