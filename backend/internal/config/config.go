package config

import (
	"fmt"
	"net"
	"os"
	"regexp"

	"github.com/BurntSushi/toml"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
)

// tomlConfig is the raw TOML-tagged representation of the config file.
type tomlConfig struct {
	Root         string            `toml:"root"`
	Port         *int              `toml:"port"`
	IPAddress    string            `toml:"ip_address"`
	DBPath       string            `toml:"db_path"`
	TrainingRuns []tomlTrainingRun `toml:"training_runs"`
}

// tomlTrainingRun is the TOML representation of a training run.
type tomlTrainingRun struct {
	Name       string          `toml:"name"`
	Pattern    string          `toml:"pattern"`
	Dimensions []tomlDimension `toml:"dimensions"`
}

// tomlDimension is the TOML representation of a dimension extraction config.
type tomlDimension struct {
	Name    string `toml:"name"`
	Type    string `toml:"type"`
	Pattern string `toml:"pattern"`
}

// DefaultConfigPath is the default path to the configuration file.
const DefaultConfigPath = "config.toml"

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

// LoadFromPath reads and parses a TOML config file at the given path.
func LoadFromPath(path string) (*model.Config, error) {
	var raw tomlConfig
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return nil, fmt.Errorf("reading config file %q: %w", path, err)
	}
	return parseAndValidate(raw)
}

// LoadFromString parses a TOML config from a string. Useful for testing.
func LoadFromString(data string) (*model.Config, error) {
	var raw tomlConfig
	if _, err := toml.Decode(data, &raw); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}
	return parseAndValidate(raw)
}

func parseAndValidate(raw tomlConfig) (*model.Config, error) {
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

	// Validate root
	if raw.Root == "" {
		return nil, fmt.Errorf("config: root is required")
	}
	info, err := os.Stat(raw.Root)
	if err != nil {
		return nil, fmt.Errorf("config: root directory %q does not exist: %w", raw.Root, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("config: root %q is not a directory", raw.Root)
	}

	// Validate port
	if port < 1 || port > 65535 {
		return nil, fmt.Errorf("config: port must be between 1 and 65535, got %d", port)
	}

	// Validate IP address
	if net.ParseIP(raw.IPAddress) == nil {
		return nil, fmt.Errorf("config: invalid ip_address %q", raw.IPAddress)
	}

	// Validate db_path is non-empty (already defaulted above)
	if raw.DBPath == "" {
		return nil, fmt.Errorf("config: db_path is required")
	}

	// Parse training runs
	runs := make([]model.TrainingRunConfig, 0, len(raw.TrainingRuns))
	for i, tr := range raw.TrainingRuns {
		if tr.Name == "" {
			return nil, fmt.Errorf("config: training_runs[%d].name is required", i)
		}
		if tr.Pattern == "" {
			return nil, fmt.Errorf("config: training_runs[%d].pattern is required", i)
		}
		re, err := regexp.Compile(tr.Pattern)
		if err != nil {
			return nil, fmt.Errorf("config: training_runs[%d].pattern is invalid regex: %w", i, err)
		}

		dims := make([]model.DimensionConfig, 0, len(tr.Dimensions))
		for j, d := range tr.Dimensions {
			if d.Name == "" {
				return nil, fmt.Errorf("config: training_runs[%d].dimensions[%d].name is required", i, j)
			}
			dimType, err := parseDimensionType(d.Type)
			if err != nil {
				return nil, fmt.Errorf("config: training_runs[%d].dimensions[%d].type: %w", i, j, err)
			}
			if d.Pattern == "" {
				return nil, fmt.Errorf("config: training_runs[%d].dimensions[%d].pattern is required", i, j)
			}
			dimRe, err := regexp.Compile(d.Pattern)
			if err != nil {
				return nil, fmt.Errorf("config: training_runs[%d].dimensions[%d].pattern is invalid regex: %w", i, j, err)
			}
			dims = append(dims, model.DimensionConfig{
				Name:    d.Name,
				Type:    dimType,
				Pattern: dimRe,
			})
		}

		runs = append(runs, model.TrainingRunConfig{
			Name:       tr.Name,
			Pattern:    re,
			Dimensions: dims,
		})
	}

	return &model.Config{
		Root:         raw.Root,
		Port:         port,
		IPAddress:    raw.IPAddress,
		DBPath:       raw.DBPath,
		TrainingRuns: runs,
	}, nil
}

func parseDimensionType(s string) (model.DimensionType, error) {
	switch s {
	case "int":
		return model.DimensionTypeInt, nil
	case "string":
		return model.DimensionTypeString, nil
	case "":
		return model.DimensionTypeString, nil // default to string
	default:
		return "", fmt.Errorf("invalid dimension type %q (must be \"int\" or \"string\")", s)
	}
}
