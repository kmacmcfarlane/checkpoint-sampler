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

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// realFileOpener implements service.CheckpointMetadataReader using the real filesystem.
type realFileOpener struct{}

func (r *realFileOpener) OpenFile(path string) (io.ReadCloser, error) {
	return os.Open(path)
}

// buildSafetensorsData creates a minimal safetensors file with the given metadata.
func buildSafetensorsData(metadata map[string]string) []byte {
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

// writeSafetensorsFile creates a safetensors file at the given path with the given metadata.
func writeSafetensorsFile(dir, filename string, metadata map[string]string) {
	data := buildSafetensorsData(metadata)
	Expect(os.MkdirAll(dir, 0755)).To(Succeed())
	Expect(os.WriteFile(filepath.Join(dir, filename), data, 0644)).To(Succeed())
}

var _ = Describe("CheckpointMetadataService", func() {
	var (
		tmpDir string
		svc    *service.CheckpointMetadataService
	)

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "checkpoint-metadata-test-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	Describe("GetMetadata", func() {
		Context("with valid safetensors files", func() {
			It("extracts ss_* metadata fields from the header", func() {
				writeSafetensorsFile(tmpDir, "model.safetensors", map[string]string{
					"ss_output_name": "test-model",
					"ss_total_steps": "9000",
					"ss_epoch":       "104",
					"ss_base_model":  "sdxl",
					"non_ss_field":   "should-be-excluded",
					"another_field":  "also-excluded",
				})
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				result, err := svc.GetMetadata("model.safetensors")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(4))
				Expect(result["ss_output_name"]).To(Equal("test-model"))
				Expect(result["ss_total_steps"]).To(Equal("9000"))
				Expect(result["ss_epoch"]).To(Equal("104"))
				Expect(result["ss_base_model"]).To(Equal("sdxl"))
				Expect(result).NotTo(HaveKey("non_ss_field"))
				Expect(result).NotTo(HaveKey("another_field"))
			})

			It("returns empty map when no __metadata__ section exists", func() {
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

				Expect(os.WriteFile(filepath.Join(tmpDir, "model.safetensors"), buf.Bytes(), 0644)).To(Succeed())
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				result, err := svc.GetMetadata("model.safetensors")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(BeEmpty())
			})

			It("returns empty map when __metadata__ has no ss_* fields", func() {
				writeSafetensorsFile(tmpDir, "model.safetensors", map[string]string{
					"format":  "pt",
					"version": "1.0",
				})
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				result, err := svc.GetMetadata("model.safetensors")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(BeEmpty())
			})

			It("finds file in subdirectory of checkpoint dir", func() {
				subDir := filepath.Join(tmpDir, "qwen")
				writeSafetensorsFile(subDir, "model.safetensors", map[string]string{
					"ss_output_name": "nested-model",
				})
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				result, err := svc.GetMetadata("model.safetensors")

				Expect(err).NotTo(HaveOccurred())
				Expect(result["ss_output_name"]).To(Equal("nested-model"))
			})

			It("searches across multiple checkpoint directories", func() {
				dir1 := filepath.Join(tmpDir, "dir1")
				dir2 := filepath.Join(tmpDir, "dir2")
				Expect(os.MkdirAll(dir1, 0755)).To(Succeed())
				Expect(os.MkdirAll(dir2, 0755)).To(Succeed())

				writeSafetensorsFile(dir2, "model.safetensors", map[string]string{
					"ss_output_name": "model-in-dir2",
				})
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{dir1, dir2})

				result, err := svc.GetMetadata("model.safetensors")

				Expect(err).NotTo(HaveOccurred())
				Expect(result["ss_output_name"]).To(Equal("model-in-dir2"))
			})

			It("handles metadata with many ss_* fields", func() {
				writeSafetensorsFile(tmpDir, "model.safetensors", map[string]string{
					"ss_output_name":        "test",
					"ss_total_steps":        "9000",
					"ss_epoch":              "104",
					"ss_base_model_version": "sdxl_base_v1-0",
					"ss_optimizer":          "AdamW8bit",
					"ss_lr_scheduler":       "cosine_with_restarts",
					"ss_learning_rate":      "0.0001",
					"ss_network_module":     "networks.lora",
					"ss_network_dim":        "16",
					"ss_network_alpha":      "8",
				})
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				result, err := svc.GetMetadata("model.safetensors")

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(10))
				Expect(result["ss_optimizer"]).To(Equal("AdamW8bit"))
				Expect(result["ss_network_dim"]).To(Equal("16"))
			})
		})

		Context("path validation", func() {
			BeforeEach(func() {
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})
			})

			It("rejects empty filename", func() {
				_, err := svc.GetMetadata("")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid filename"))
			})

			It("rejects filename with forward slash", func() {
				_, err := svc.GetMetadata("../etc/passwd")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid filename"))
			})

			It("rejects filename with backslash", func() {
				_, err := svc.GetMetadata("..\\etc\\passwd")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid filename"))
			})

			It("rejects dot-dot filename", func() {
				_, err := svc.GetMetadata("..")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid filename"))
			})

			It("rejects single dot filename", func() {
				_, err := svc.GetMetadata(".")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("invalid filename"))
			})
		})

		Context("error handling", func() {
			It("returns error when file is not found in any checkpoint dir", func() {
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				_, err := svc.GetMetadata("nonexistent.safetensors")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("not found"))
			})

			It("returns error for truncated safetensors file", func() {
				// Write a file with truncated header
				Expect(os.WriteFile(filepath.Join(tmpDir, "bad.safetensors"), []byte{0x01, 0x02}, 0644)).To(Succeed())
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				_, err := svc.GetMetadata("bad.safetensors")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("parsing safetensors header"))
			})

			It("returns error for invalid JSON in header", func() {
				// Write a file with valid header length but invalid JSON
				buf := new(bytes.Buffer)
				invalidJSON := []byte(`{not valid json`)
				_ = binary.Write(buf, binary.LittleEndian, uint64(len(invalidJSON)))
				buf.Write(invalidJSON)
				Expect(os.WriteFile(filepath.Join(tmpDir, "badjson.safetensors"), buf.Bytes(), 0644)).To(Succeed())
				svc = service.NewCheckpointMetadataService(&realFileOpener{}, []string{tmpDir})

				_, err := svc.GetMetadata("badjson.safetensors")

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("parsing safetensors header"))
			})
		})
	})

	Describe("MetadataKeys", func() {
		It("returns sorted keys", func() {
			metadata := map[string]string{
				"ss_total_steps": "9000",
				"ss_epoch":       "104",
				"ss_output_name": "test",
				"ss_base_model":  "sdxl",
			}

			keys := service.MetadataKeys(metadata)

			Expect(keys).To(Equal([]string{
				"ss_base_model",
				"ss_epoch",
				"ss_output_name",
				"ss_total_steps",
			}))
		})

		It("returns empty slice for empty map", func() {
			keys := service.MetadataKeys(map[string]string{})

			Expect(keys).To(BeEmpty())
		})
	})
})
