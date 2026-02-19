package config_test

import (
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/config"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
)

var _ = Describe("Config", func() {

	var tmpDir string

	BeforeEach(func() {
		var err error
		tmpDir, err = os.MkdirTemp("", "config-test-root-*")
		Expect(err).NotTo(HaveOccurred())
	})

	AfterEach(func() {
		os.RemoveAll(tmpDir)
	})

	validConfig := func(root string) string {
		return `
root = "` + root + `"
port = 9090
ip_address = "0.0.0.0"
db_path = "./data/test.db"

[[training_runs]]
name = "test run"
pattern = '^test/run-.+'

  [[training_runs.dimensions]]
  name = "step"
  type = "int"
  pattern = '-steps-(\d+)-'

  [[training_runs.dimensions]]
  name = "checkpoint"
  type = "string"
  pattern = '([^/]+)$'
`
	}

	Describe("LoadFromString", func() {
		Context("with a valid configuration", func() {
			It("parses all fields correctly", func() {
				cfg, err := config.LoadFromString(validConfig(tmpDir))
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg).NotTo(BeNil())

				Expect(cfg.Root).To(Equal(tmpDir))
				Expect(cfg.Port).To(Equal(9090))
				Expect(cfg.IPAddress).To(Equal("0.0.0.0"))
				Expect(cfg.DBPath).To(Equal("./data/test.db"))

				Expect(cfg.TrainingRuns).To(HaveLen(1))
				tr := cfg.TrainingRuns[0]
				Expect(tr.Name).To(Equal("test run"))
				Expect(tr.Pattern).NotTo(BeNil())
				Expect(tr.Pattern.MatchString("test/run-something")).To(BeTrue())
				Expect(tr.Pattern.MatchString("other/path")).To(BeFalse())

				Expect(tr.Dimensions).To(HaveLen(2))
				Expect(tr.Dimensions[0].Name).To(Equal("step"))
				Expect(tr.Dimensions[0].Type).To(Equal(model.DimensionTypeInt))
				Expect(tr.Dimensions[0].Pattern.FindStringSubmatch("foo-steps-1000-bar")).To(Equal([]string{"-steps-1000-", "1000"}))

				Expect(tr.Dimensions[1].Name).To(Equal("checkpoint"))
				Expect(tr.Dimensions[1].Type).To(Equal(model.DimensionTypeString))
			})
		})

		Context("with defaults applied", func() {
			It("uses default port when not specified", func() {
				tomlStr := `root = "` + tmpDir + `"`
				cfg, err := config.LoadFromString(tomlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.Port).To(Equal(8080))
			})

			It("uses default ip_address when not specified", func() {
				tomlStr := `root = "` + tmpDir + `"`
				cfg, err := config.LoadFromString(tomlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.IPAddress).To(Equal("127.0.0.1"))
			})

			It("uses default db_path when not specified", func() {
				tomlStr := `root = "` + tmpDir + `"`
				cfg, err := config.LoadFromString(tomlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.DBPath).To(Equal("./data/"))
			})
		})

		Context("with no training runs", func() {
			It("returns an empty training runs list", func() {
				tomlStr := `root = "` + tmpDir + `"`
				cfg, err := config.LoadFromString(tomlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.TrainingRuns).To(BeEmpty())
			})
		})

		Context("with dimension type defaulting", func() {
			It("defaults empty type to string", func() {
				tomlStr := `
root = "` + tmpDir + `"

[[training_runs]]
name = "run1"
pattern = '^test'

  [[training_runs.dimensions]]
  name = "dim1"
  pattern = '(\d+)'
`
				cfg, err := config.LoadFromString(tomlStr)
				Expect(err).NotTo(HaveOccurred())
				Expect(cfg.TrainingRuns[0].Dimensions[0].Type).To(Equal(model.DimensionTypeString))
			})
		})
	})

	Describe("Validation errors", func() {
		DescribeTable("rejects invalid configurations",
			func(tomlStr string, expectedErr string) {
				_, err := config.LoadFromString(tomlStr)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring(expectedErr))
			},
			Entry("missing root",
				`port = 8080`,
				"root is required",
			),
			Entry("root directory does not exist",
				`root = "/nonexistent/path/that/does/not/exist"`,
				"does not exist",
			),
			Entry("invalid port (too low)",
				func() string { return `root = "` + os.TempDir() + `"` + "\nport = 0" }(),
				"port must be between 1 and 65535",
			),
			Entry("invalid port (too high)",
				func() string { return `root = "` + os.TempDir() + `"` + "\nport = 70000" }(),
				"port must be between 1 and 65535",
			),
			Entry("invalid ip_address",
				func() string { return `root = "` + os.TempDir() + `"` + "\n" + `ip_address = "not-an-ip"` }(),
				"invalid ip_address",
			),
			Entry("invalid training run pattern (bad regex)",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
name = "bad"
pattern = '[invalid'
`
				}(),
				"invalid regex",
			),
			Entry("missing training run name",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
pattern = '^test'
`
				}(),
				"name is required",
			),
			Entry("missing training run pattern",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
name = "test"
`
				}(),
				"pattern is required",
			),
			Entry("missing dimension name",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
name = "test"
pattern = '^test'

  [[training_runs.dimensions]]
  type = "int"
  pattern = '(\d+)'
`
				}(),
				"name is required",
			),
			Entry("invalid dimension type",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
name = "test"
pattern = '^test'

  [[training_runs.dimensions]]
  name = "dim1"
  type = "boolean"
  pattern = '(\d+)'
`
				}(),
				"invalid dimension type",
			),
			Entry("missing dimension pattern",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
name = "test"
pattern = '^test'

  [[training_runs.dimensions]]
  name = "dim1"
  type = "int"
`
				}(),
				"pattern is required",
			),
			Entry("invalid dimension pattern (bad regex)",
				func() string {
					return `root = "` + os.TempDir() + `"` + "\n" + `
[[training_runs]]
name = "test"
pattern = '^test'

  [[training_runs.dimensions]]
  name = "dim1"
  type = "int"
  pattern = '[bad'
`
				}(),
				"invalid regex",
			),
		)
	})

	Describe("LoadFromPath", func() {
		It("reads and parses a config file from disk", func() {
			configPath := filepath.Join(tmpDir, "test-config.toml")
			content := `
root = "` + tmpDir + `"
port = 3000
ip_address = "192.168.1.100"
db_path = "./mydata/"

[[training_runs]]
name = "file-test-run"
pattern = '^sample/.+'
`
			err := os.WriteFile(configPath, []byte(content), 0644)
			Expect(err).NotTo(HaveOccurred())

			cfg, err := config.LoadFromPath(configPath)
			Expect(err).NotTo(HaveOccurred())
			Expect(cfg.Root).To(Equal(tmpDir))
			Expect(cfg.Port).To(Equal(3000))
			Expect(cfg.IPAddress).To(Equal("192.168.1.100"))
			Expect(cfg.DBPath).To(Equal("./mydata/"))
			Expect(cfg.TrainingRuns).To(HaveLen(1))
			Expect(cfg.TrainingRuns[0].Name).To(Equal("file-test-run"))
		})

		It("returns an error for a nonexistent file", func() {
			_, err := config.LoadFromPath("/nonexistent/config.toml")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("reading config file"))
		})

		It("returns an error for invalid TOML syntax", func() {
			configPath := filepath.Join(tmpDir, "bad.toml")
			err := os.WriteFile(configPath, []byte("not valid toml {{{}}}"), 0644)
			Expect(err).NotTo(HaveOccurred())

			_, err = config.LoadFromPath(configPath)
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("Load", func() {
		It("uses CONFIG_PATH env var when set", func() {
			configPath := filepath.Join(tmpDir, "env-config.toml")
			content := `root = "` + tmpDir + `"`
			err := os.WriteFile(configPath, []byte(content), 0644)
			Expect(err).NotTo(HaveOccurred())

			os.Setenv(config.ConfigPathEnvVar, configPath)
			defer os.Unsetenv(config.ConfigPathEnvVar)

			cfg, err := config.Load()
			Expect(err).NotTo(HaveOccurred())
			Expect(cfg.Root).To(Equal(tmpDir))
		})
	})

	Describe("Root validation", func() {
		It("rejects a root path that is a file, not a directory", func() {
			filePath := filepath.Join(tmpDir, "afile.txt")
			err := os.WriteFile(filePath, []byte("hi"), 0644)
			Expect(err).NotTo(HaveOccurred())

			tomlStr := `root = "` + filePath + `"`
			_, err = config.LoadFromString(tomlStr)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not a directory"))
		})
	})
})
