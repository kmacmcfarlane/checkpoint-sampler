package config

import (
	"fmt"
	"net"
	"os"

	"gopkg.in/yaml.v3"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
)

// yamlConfig is the raw YAML-tagged representation of the config file.
type yamlConfig struct {
	CheckpointDirs []string `yaml:"checkpoint_dirs"`
	SampleDir      string   `yaml:"sample_dir"`
	Port           *int     `yaml:"port"`
	IPAddress      string   `yaml:"ip_address"`
	DBPath         string   `yaml:"db_path"`
}

// DefaultConfigPath is the default path to the configuration file.
const DefaultConfigPath = "config.yaml"

// ConfigPathEnvVar is the environment variable that overrides the config path.
const ConfigPathEnvVar = "CONFIG_PATH"

// Load reads the configuration file from the path specified by CONFIG_PATH
// env var, or DefaultConfigPath if not set. It parses, validates, and returns
// the domain config.
func Load() (*model.Config, error) {
	path := os.Getenv(ConfigPathEnvVar)
	if path == "" {
		path = DefaultConfigPath
	}
	return LoadFromPath(path)
}

// LoadFromPath reads and parses a YAML config file at the given path.
func LoadFromPath(path string) (*model.Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config file %q: %w", path, err)
	}
	return LoadFromString(string(data))
}

// LoadFromString parses a YAML config from a string. Useful for testing.
func LoadFromString(data string) (*model.Config, error) {
	var raw yamlConfig
	if err := yaml.Unmarshal([]byte(data), &raw); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	return parseAndValidate(raw)
}

func parseAndValidate(raw yamlConfig) (*model.Config, error) {
	// Apply defaults
	port := 8080
	if raw.Port != nil {
		port = *raw.Port
	}
	if raw.IPAddress == "" {
		raw.IPAddress = "127.0.0.1"
	}
	if raw.DBPath == "" {
		raw.DBPath = "./data/"
	}

	// Validate checkpoint_dirs
	if len(raw.CheckpointDirs) == 0 {
		return nil, fmt.Errorf("config: checkpoint_dirs is required (at least one directory)")
	}
	for i, dir := range raw.CheckpointDirs {
		if dir == "" {
			return nil, fmt.Errorf("config: checkpoint_dirs[%d] is empty", i)
		}
		info, err := os.Stat(dir)
		if err != nil {
			return nil, fmt.Errorf("config: checkpoint_dirs[%d] %q does not exist: %w", i, dir, err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("config: checkpoint_dirs[%d] %q is not a directory", i, dir)
		}
	}

	// Validate sample_dir
	if raw.SampleDir == "" {
		return nil, fmt.Errorf("config: sample_dir is required")
	}
	info, err := os.Stat(raw.SampleDir)
	if err != nil {
		return nil, fmt.Errorf("config: sample_dir %q does not exist: %w", raw.SampleDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("config: sample_dir %q is not a directory", raw.SampleDir)
	}

	// Validate port
	if port < 1 || port > 65535 {
		return nil, fmt.Errorf("config: port must be between 1 and 65535, got %d", port)
	}

	// Validate IP address
	if net.ParseIP(raw.IPAddress) == nil {
		return nil, fmt.Errorf("config: invalid ip_address %q", raw.IPAddress)
	}

	return &model.Config{
		CheckpointDirs: raw.CheckpointDirs,
		SampleDir:      raw.SampleDir,
		Port:           port,
		IPAddress:      raw.IPAddress,
		DBPath:         raw.DBPath,
	}, nil
}
