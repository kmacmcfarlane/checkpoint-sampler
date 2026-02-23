package api_test

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
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

var _ = Describe("ImageMetadataHandler", func() {
	var (
		server    *httptest.Server
		client    *http.Client
		sampleDir string
		logger    *logrus.Logger
	)

	BeforeEach(func() {
		var err error
		sampleDir, err = os.MkdirTemp("", "image-metadata-handler-test-*")
		Expect(err).NotTo(HaveOccurred())
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	AfterEach(func() {
		if server != nil {
			server.Close()
		}
		os.RemoveAll(sampleDir)
	})

	setupServer := func() {
		fs := &realFileReader{}
		metadataSvc := service.NewImageMetadataService(fs, sampleDir, logger)
		imageHandler := api.NewImageHandler(sampleDir)
		imageHandler.SetMetadataHandler(api.NewImageMetadataHandler(metadataSvc))

		mux := http.NewServeMux()
		mux.Handle("/api/images/", imageHandler)

		server = httptest.NewServer(mux)
		client = server.Client()
	}

	Describe("GET /api/images/{filepath}/metadata", func() {
		It("returns metadata from PNG tEXt chunks", func() {
			subDir := filepath.Join(sampleDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			data := buildTestPNGWithTextChunks(map[string]string{
				"prompt":   `{"3": {"class_type": "KSampler"}}`,
				"workflow": `{"nodes": []}`,
			})
			Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

			setupServer()

			resp, err := client.Get(server.URL + "/api/images/checkpoint.safetensors/image.png/metadata")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resp.Header.Get("Content-Type")).To(ContainSubstring("application/json"))

			var result map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&result)
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveKey("metadata"))

			metadata := result["metadata"].(map[string]interface{})
			Expect(metadata["prompt"]).To(Equal(`{"3": {"class_type": "KSampler"}}`))
			Expect(metadata["workflow"]).To(Equal(`{"nodes": []}`))
		})

		It("returns empty metadata for PNG without tEXt chunks", func() {
			subDir := filepath.Join(sampleDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			data := buildTestMinimalPNG()
			Expect(os.WriteFile(filepath.Join(subDir, "image.png"), data, 0644)).To(Succeed())

			setupServer()

			resp, err := client.Get(server.URL + "/api/images/checkpoint.safetensors/image.png/metadata")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))

			var result map[string]interface{}
			err = json.NewDecoder(resp.Body).Decode(&result)
			Expect(err).NotTo(HaveOccurred())
			Expect(result["metadata"]).To(BeEmpty())
		})

		It("returns 404 for nonexistent image", func() {
			setupServer()

			resp, err := client.Get(server.URL + "/api/images/nonexistent/image.png/metadata")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusNotFound))
		})

		It("returns 400 for path traversal attempt", func() {
			setupServer()

			resp, err := client.Get(server.URL + "/api/images/checkpoint.safetensors/..%2F..%2Fetc%2Fpasswd/metadata")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK))
		})

		It("still serves regular images when metadata handler is set", func() {
			subDir := filepath.Join(sampleDir, "checkpoint.safetensors")
			Expect(os.MkdirAll(subDir, 0755)).To(Succeed())

			// Write a minimal PNG
			pngData := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
			Expect(os.WriteFile(filepath.Join(subDir, "test.png"), pngData, 0644)).To(Succeed())

			setupServer()

			resp, err := client.Get(server.URL + "/api/images/checkpoint.safetensors/test.png")
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resp.Header.Get("Content-Type")).To(Equal("image/png"))
		})
	})
})
