package config

import (
	"fmt"
	"net"
	"net/url"
	"os"

	"gopkg.in/yaml.v3"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// yamlConfig is the raw YAML-tagged representation of the config file.
type yamlConfig struct {
	CheckpointDirs []string             `yaml:"checkpoint_dirs"`
	SampleDir      string               `yaml:"sample_dir"`
	Port           *int                 `yaml:"port"`
	IPAddress      string               `yaml:"ip_address"`
	DBPath         string               `yaml:"db_path"`
	ComfyUI        *yamlComfyUIConfig   `yaml:"comfyui"`
	Thumbnails     *yamlThumbnailConfig `yaml:"thumbnails"`
	WsPingInterval *int                 `yaml:"ws_ping_interval"`
}

// yamlThumbnailConfig is the raw YAML-tagged representation of thumbnail config.
type yamlThumbnailConfig struct {
	Enabled        bool `yaml:"enabled"`
	MaxResolutionX *int `yaml:"max_resolution_x"`
	MaxResolutionY *int `yaml:"max_resolution_y"`
	JPEGQuality    *int `yaml:"jpeg_quality"`
}

// yamlComfyUIConfig is the raw YAML-tagged representation of ComfyUI config.
type yamlComfyUIConfig struct {
	URL               string `yaml:"url"`
	WorkflowDir       string `yaml:"workflow_dir"`
	ReconnectInterval *int   `yaml:"reconnect_interval"`
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
	wsPingInterval := 30 // default: 30 seconds
	if raw.WsPingInterval != nil {
		wsPingInterval = *raw.WsPingInterval
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

	// Validate ws_ping_interval (0 disables pings; negative values are invalid)
	if wsPingInterval < 0 {
		return nil, fmt.Errorf("config: ws_ping_interval must be >= 0, got %d", wsPingInterval)
	}

	// Validate IP address
	if net.ParseIP(raw.IPAddress) == nil {
		return nil, fmt.Errorf("config: invalid ip_address %q", raw.IPAddress)
	}

	// Parse and validate ComfyUI config if present
	var comfyUI *model.ComfyUIConfig
	if raw.ComfyUI != nil {
		comfyUI, err = parseComfyUIConfig(raw.ComfyUI)
		if err != nil {
			return nil, err
		}
	}

	// Parse and validate thumbnail config if present
	var thumbnails *model.ThumbnailConfig
	if raw.Thumbnails != nil {
		thumbnails, err = parseThumbnailConfig(raw.Thumbnails)
		if err != nil {
			return nil, err
		}
	}

	return &model.Config{
		CheckpointDirs: raw.CheckpointDirs,
		SampleDir:      raw.SampleDir,
		Port:           port,
		IPAddress:      raw.IPAddress,
		DBPath:         raw.DBPath,
		ComfyUI:        comfyUI,
		Thumbnails:     thumbnails,
		WsPingInterval: wsPingInterval,
	}, nil
}

// parseThumbnailConfig parses and validates the thumbnail configuration section.
func parseThumbnailConfig(raw *yamlThumbnailConfig) (*model.ThumbnailConfig, error) {
	// Apply defaults
	maxResX := 512
	if raw.MaxResolutionX != nil {
		maxResX = *raw.MaxResolutionX
	}
	maxResY := 512
	if raw.MaxResolutionY != nil {
		maxResY = *raw.MaxResolutionY
	}
	quality := 85
	if raw.JPEGQuality != nil {
		quality = *raw.JPEGQuality
	}

	// Validate
	if maxResX < 1 {
		return nil, fmt.Errorf("config: thumbnails.max_resolution_x must be at least 1, got %d", maxResX)
	}
	if maxResY < 1 {
		return nil, fmt.Errorf("config: thumbnails.max_resolution_y must be at least 1, got %d", maxResY)
	}
	if quality < 1 || quality > 100 {
		return nil, fmt.Errorf("config: thumbnails.jpeg_quality must be between 1 and 100, got %d", quality)
	}

	return &model.ThumbnailConfig{
		Enabled:        raw.Enabled,
		MaxResolutionX: maxResX,
		MaxResolutionY: maxResY,
		JPEGQuality:    quality,
	}, nil
}

func parseComfyUIConfig(raw *yamlComfyUIConfig) (*model.ComfyUIConfig, error) {
	// Apply defaults
	rawURL := "http://localhost:8188"
	if raw.URL != "" {
		rawURL = raw.URL
	}
	workflowDir := "./workflows"
	if raw.WorkflowDir != "" {
		workflowDir = raw.WorkflowDir
	}
	reconnectInterval := 10 // default: 10 seconds
	if raw.ReconnectInterval != nil {
		reconnectInterval = *raw.ReconnectInterval
	}

	// Validate URL
	parsedURL, err := parseAndValidateURL(rawURL)
	if err != nil {
		return nil, fmt.Errorf("config: comfyui.url: %w", err)
	}

	// Validate reconnect_interval (must be >= 1)
	if reconnectInterval < 1 {
		return nil, fmt.Errorf("config: comfyui.reconnect_interval must be at least 1, got %d", reconnectInterval)
	}

	return &model.ComfyUIConfig{
		URL:               parsedURL,
		WorkflowDir:       workflowDir,
		ReconnectInterval: reconnectInterval,
	}, nil
}

// parseAndValidateURL validates that the URL is well-formed and has a scheme.
func parseAndValidateURL(urlStr string) (string, error) {
	if urlStr == "" {
		return "", fmt.Errorf("url cannot be empty")
	}

	// Parse the URL
	parsedURL, err := url.Parse(urlStr)
	if err != nil {
		return "", fmt.Errorf("invalid url: %w", err)
	}

	// Ensure scheme is present
	if parsedURL.Scheme == "" {
		return "", fmt.Errorf("url must include a scheme (e.g., http:// or https://)")
	}

	// Ensure scheme is http or https
	if parsedURL.Scheme != "http" && parsedURL.Scheme != "https" {
		return "", fmt.Errorf("url scheme must be http or https, got %q", parsedURL.Scheme)
	}

	// Ensure host is present
	if parsedURL.Host == "" {
		return "", fmt.Errorf("url must include a host")
	}

	return urlStr, nil
}
