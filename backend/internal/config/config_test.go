package config_test

import (
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/config"
)

var _ = Describe("Config", func() {

	var tmpDir string
	var sampleDir string

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "config-test-*")
		Expect(err).NotTo(HaveOccurred())

		// Create checkpoint and sample subdirectories
		sampleDir = filepath.Join(tmpDir, "samples")
		Expect(os.MkdirAll(filepath.Join(tmpDir, "checkpoints"), 0755)).To(Succeed())
		Expect(os.MkdirAll(sampleDir, 0755)).To(Succeed())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	validConfig := func() string {
		return `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
port: 9090
ip_address: "0.0.0.0"
db_path: "./data/test.db"
`
	}

	Describe("LoadFromString", func() {
		Context("with a valid configuration", func() {
			It("parses all fields correctly", func() {
				cfg, err := config.LoadFromString(validConfig())
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg).NotTo(BeNil())

				Expect(cfg.CheckpointDirs).To(HaveLen(1))
				Expect(cfg.CheckpointDirs[0]).To(Equal(filepath.Join(tmpDir, "checkpoints")))
				Expect(cfg.SampleDir).To(Equal(sampleDir))
				Expect(cfg.Port).To(Equal(9090))
				Expect(cfg.IPAddress).To(Equal("0.0.0.0"))
				Expect(cfg.DBPath).To(Equal("./data/test.db"))
			})
		})

		Context("with multiple checkpoint directories", func() {
			It("parses all checkpoint dirs", func() {
				dir2 := filepath.Join(tmpDir, "checkpoints2")
				Expect(os.MkdirAll(dir2, 0755)).To(Succeed())

				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
  - "` + dir2 + `"
sample_dir: "` + sampleDir + `"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.CheckpointDirs).To(HaveLen(2))
			})
		})

		Context("with defaults applied", func() {
			It("uses default port when not specified", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.Port).To(Equal(8080))
			})

			It("uses default ip_address when not specified", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.IPAddress).To(Equal("127.0.0.1"))
			})

			It("uses default db_path when not specified", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.DBPath).To(Equal("./data/"))
			})
		})
	})

	Describe("Validation errors", func() {
		DescribeTable("rejects invalid configurations",
			func(yamlStr string, expectedErr string) {
				_, err := config.LoadFromString(yamlStr)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring(expectedErr))
			},
			Entry("missing checkpoint_dirs",
				`sample_dir: "`+os.TempDir()+`"`,
				"checkpoint_dirs is required",
			),
			Entry("empty checkpoint_dirs list",
				"checkpoint_dirs: []\nsample_dir: \""+os.TempDir()+"\"",
				"checkpoint_dirs is required",
			),
			Entry("checkpoint_dir does not exist",
				"checkpoint_dirs:\n  - /nonexistent/path\nsample_dir: \""+os.TempDir()+"\"",
				"does not exist",
			),
			Entry("missing sample_dir",
				"checkpoint_dirs:\n  - \""+os.TempDir()+"\"",
				"sample_dir is required",
			),
			Entry("sample_dir does not exist",
				"checkpoint_dirs:\n  - \""+os.TempDir()+"\"\nsample_dir: /nonexistent/path",
				"does not exist",
			),
			Entry("invalid port (too low)",
				"checkpoint_dirs:\n  - \""+os.TempDir()+"\"\nsample_dir: \""+os.TempDir()+"\"\nport: 0",
				"port must be between 1 and 65535",
			),
			Entry("invalid port (too high)",
				"checkpoint_dirs:\n  - \""+os.TempDir()+"\"\nsample_dir: \""+os.TempDir()+"\"\nport: 70000",
				"port must be between 1 and 65535",
			),
			Entry("invalid ip_address",
				"checkpoint_dirs:\n  - \""+os.TempDir()+"\"\nsample_dir: \""+os.TempDir()+"\"\nip_address: not-an-ip",
				"invalid ip_address",
			),
		)
	})

	Describe("LoadFromPath", func() {
		It("reads and parses a config file from disk", func() {
			configPath := filepath.Join(tmpDir, "test-config.yaml")
			content := validConfig()
			err := os.WriteFile(configPath, []byte(content), 0644)
			Expect(err).NotTo(HaveOccurred())

			cfg, err := config.LoadFromPath(configPath)
			Expect(err).NotTo(HaveOccurred())
			Expect(cfg.CheckpointDirs).To(HaveLen(1))
			Expect(cfg.Port).To(Equal(9090))
			Expect(cfg.IPAddress).To(Equal("0.0.0.0"))
			Expect(cfg.DBPath).To(Equal("./data/test.db"))
		})

		It("returns an error for a nonexistent file", func() {
			_, err := config.LoadFromPath("/nonexistent/config.yaml")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("reading config file"))
		})

		It("returns an error for invalid YAML syntax", func() {
			configPath := filepath.Join(tmpDir, "bad.yaml")
			err := os.WriteFile(configPath, []byte("not: valid: yaml: {{{}}}"), 0644)
			Expect(err).NotTo(HaveOccurred())

			_, err = config.LoadFromPath(configPath)
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("Load", func() {
		It("uses CONFIG_PATH env var when set", func() {
			configPath := filepath.Join(tmpDir, "env-config.yaml")
			content := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
`
			err := os.WriteFile(configPath, []byte(content), 0644)
			Expect(err).NotTo(HaveOccurred())

			os.Setenv(config.ConfigPathEnvVar, configPath)
			defer os.Unsetenv(config.ConfigPathEnvVar)

			cfg, err := config.Load()
			Expect(err).NotTo(HaveOccurred())
			Expect(cfg.CheckpointDirs).To(HaveLen(1))
		})
	})

	Describe("Directory validation", func() {
		It("rejects a checkpoint_dir that is a file, not a directory", func() {
			filePath := filepath.Join(tmpDir, "afile.txt")
			err := os.WriteFile(filePath, []byte("hi"), 0644)
			Expect(err).NotTo(HaveOccurred())

			yamlStr := `
checkpoint_dirs:
  - "` + filePath + `"
sample_dir: "` + sampleDir + `"
`
			_, err = config.LoadFromString(yamlStr)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not a directory"))
		})

		It("rejects a sample_dir that is a file, not a directory", func() {
			filePath := filepath.Join(tmpDir, "afile2.txt")
			err := os.WriteFile(filePath, []byte("hi"), 0644)
			Expect(err).NotTo(HaveOccurred())

			yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + filePath + `"
`
			_, err = config.LoadFromString(yamlStr)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not a directory"))
		})
	})

	Describe("ComfyUI configuration", func() {
		Context("when comfyui section is present", func() {
			It("parses comfyui config with all fields", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
comfyui:
  host: "192.168.1.100"
  port: 8188
  workflow_dir: "/custom/workflows"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.ComfyUI).NotTo(BeNil())
				Expect(cfg.ComfyUI.Host).To(Equal("192.168.1.100"))
				Expect(cfg.ComfyUI.Port).To(Equal(8188))
				Expect(cfg.ComfyUI.WorkflowDir).To(Equal("/custom/workflows"))
			})

			It("uses default host when not specified", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
comfyui:
  port: 8188
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.ComfyUI).NotTo(BeNil())
				Expect(cfg.ComfyUI.Host).To(Equal("localhost"))
			})

			It("uses default port when not specified", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
comfyui:
  host: "localhost"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.ComfyUI).NotTo(BeNil())
				Expect(cfg.ComfyUI.Port).To(Equal(8188))
			})

			It("uses default workflow_dir when not specified", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
comfyui:
  host: "localhost"
  port: 8188
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.ComfyUI).NotTo(BeNil())
				Expect(cfg.ComfyUI.WorkflowDir).To(Equal("./workflows"))
			})
		})

		Context("when comfyui section is absent", func() {
			It("sets ComfyUI to nil", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
`
				cfg, err := config.LoadFromString(yamlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.ComfyUI).To(BeNil())
			})
		})

		Context("comfyui validation errors", func() {
			It("rejects invalid port (too low)", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
comfyui:
  port: 0
`
				_, err := config.LoadFromString(yamlStr)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("comfyui.port must be between 1 and 65535"))
			})

			It("rejects invalid port (too high)", func() {
				yamlStr := `
checkpoint_dirs:
  - "` + filepath.Join(tmpDir, "checkpoints") + `"
sample_dir: "` + sampleDir + `"
comfyui:
  port: 70000
`
				_, err := config.LoadFromString(yamlStr)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("comfyui.port must be between 1 and 65535"))
			})
		})
	})
})
