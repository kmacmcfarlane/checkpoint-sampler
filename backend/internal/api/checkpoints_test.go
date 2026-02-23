package api_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// fakeMetadataReader implements service.CheckpointMetadataReader for testing.
type fakeMetadataReader struct {
	files map[string][]byte
}

func newFakeMetadataReader() *fakeMetadataReader {
	return &fakeMetadataReader{files: make(map[string][]byte)}
}

func (f *fakeMetadataReader) OpenFile(path string) (io.ReadCloser, error) {
	data, ok := f.files[path]
	if !ok {
		return nil, fmt.Errorf("file not found: %s", path)
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

// buildSafetensorsFile creates a minimal safetensors file with the given metadata.
func buildSafetensorsFile(metadata map[string]string) []byte {
	header := make(map[string]interface{})
	if metadata != nil {
		header["__metadata__"] = metadata
	}
	header["weight"] = map[string]interface{}{
		"dtype":        "F32",
		"shape":        []int{10, 10},
		"data_offsets": []int{0, 400},
	}

	headerBytes, _ := json.Marshal(header)
	buf := new(bytes.Buffer)
	_ = binary.Write(buf, binary.LittleEndian, uint64(len(headerBytes)))
	buf.Write(headerBytes)
	return buf.Bytes()
}

var _ = Describe("CheckpointsService", func() {
	var (
		tmpDir string
		logger *logrus.Logger
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "checkpoints-test-*")
		Expect(err).NotTo(HaveOccurred())
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	Describe("Metadata", func() {
		It("returns ss_* metadata for a valid checkpoint file", func() {
			// Create a fake safetensors file on disk
			data := buildSafetensorsFile(map[string]string{
				"ss_output_name": "test-model",
				"ss_total_steps": "9000",
				"ss_epoch":       "104",
				"other_field":    "excluded",
			})
			err := os.WriteFile(filepath.Join(tmpDir, "model.safetensors"), data, 0644)
			Expect(err).NotTo(HaveOccurred())

			reader := newFakeMetadataReader()
			reader.files[filepath.Join(tmpDir, "model.safetensors")] = data
			metadataSvc := service.NewCheckpointMetadataService(reader, []string{tmpDir}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			result, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "model.safetensors",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Metadata).To(HaveLen(3))
			Expect(result.Metadata["ss_output_name"]).To(Equal("test-model"))
			Expect(result.Metadata["ss_total_steps"]).To(Equal("9000"))
			Expect(result.Metadata["ss_epoch"]).To(Equal("104"))
			Expect(result.Metadata).NotTo(HaveKey("other_field"))
		})

		It("returns empty metadata map when no ss_* fields exist", func() {
			data := buildSafetensorsFile(map[string]string{
				"format":  "pt",
				"version": "1.0",
			})
			err := os.WriteFile(filepath.Join(tmpDir, "model.safetensors"), data, 0644)
			Expect(err).NotTo(HaveOccurred())

			reader := newFakeMetadataReader()
			reader.files[filepath.Join(tmpDir, "model.safetensors")] = data
			metadataSvc := service.NewCheckpointMetadataService(reader, []string{tmpDir}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			result, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "model.safetensors",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Metadata).To(BeEmpty())
		})

		It("returns empty metadata map when no __metadata__ section", func() {
			header := map[string]interface{}{
				"weight": map[string]interface{}{
					"dtype":        "F32",
					"shape":        []int{10, 10},
					"data_offsets": []int{0, 400},
				},
			}
			headerBytes, _ := json.Marshal(header)
			buf := new(bytes.Buffer)
			_ = binary.Write(buf, binary.LittleEndian, uint64(len(headerBytes)))
			buf.Write(headerBytes)
			data := buf.Bytes()

			err := os.WriteFile(filepath.Join(tmpDir, "model.safetensors"), data, 0644)
			Expect(err).NotTo(HaveOccurred())

			reader := newFakeMetadataReader()
			reader.files[filepath.Join(tmpDir, "model.safetensors")] = data
			metadataSvc := service.NewCheckpointMetadataService(reader, []string{tmpDir}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			result, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "model.safetensors",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Metadata).To(BeEmpty())
		})

		It("returns invalid_filename error for path traversal attempt", func() {
			reader := newFakeMetadataReader()
			metadataSvc := service.NewCheckpointMetadataService(reader, []string{tmpDir}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			_, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "../etc/passwd",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid filename"))
		})

		It("returns not_found error for nonexistent file", func() {
			reader := newFakeMetadataReader()
			metadataSvc := service.NewCheckpointMetadataService(reader, []string{tmpDir}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			_, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "nonexistent.safetensors",
			})

			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("finds checkpoint file in subdirectory via filesystem walk", func() {
			// Create subdirectory with checkpoint file
			subDir := filepath.Join(tmpDir, "qwen")
			err := os.MkdirAll(subDir, 0755)
			Expect(err).NotTo(HaveOccurred())

			data := buildSafetensorsFile(map[string]string{
				"ss_output_name": "nested-model",
			})
			filePath := filepath.Join(subDir, "model.safetensors")
			err = os.WriteFile(filePath, data, 0644)
			Expect(err).NotTo(HaveOccurred())

			// Use a real file reader for this test (not fakeMetadataReader)
			// since we need to test the actual filesystem walk + read
			realReader := &realFileReader{}
			metadataSvc := service.NewCheckpointMetadataService(realReader, []string{tmpDir}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			result, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "model.safetensors",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Metadata["ss_output_name"]).To(Equal("nested-model"))
		})

		It("searches across multiple checkpoint directories", func() {
			dir1 := filepath.Join(tmpDir, "dir1")
			dir2 := filepath.Join(tmpDir, "dir2")
			Expect(os.MkdirAll(dir1, 0755)).To(Succeed())
			Expect(os.MkdirAll(dir2, 0755)).To(Succeed())

			data := buildSafetensorsFile(map[string]string{
				"ss_output_name": "model-in-dir2",
			})
			Expect(os.WriteFile(filepath.Join(dir2, "model.safetensors"), data, 0644)).To(Succeed())

			realReader := &realFileReader{}
			metadataSvc := service.NewCheckpointMetadataService(realReader, []string{dir1, dir2}, logger)
			svc := api.NewCheckpointsService(metadataSvc)

			result, err := svc.Metadata(context.Background(), &gencheckpoints.MetadataPayload{
				Filename: "model.safetensors",
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Metadata["ss_output_name"]).To(Equal("model-in-dir2"))
		})
	})
})

// realFileReader opens real files from the filesystem.
type realFileReader struct{}

func (r *realFileReader) OpenFile(path string) (io.ReadCloser, error) {
	return os.Open(path)
}
