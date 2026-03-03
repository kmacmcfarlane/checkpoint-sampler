package service

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// DemoFileSystem defines filesystem operations the demo service needs.
type DemoFileSystem interface {
	DirectoryExists(path string) bool
}

// DemoPresetStore defines persistence operations for demo preset management.
type DemoPresetStore interface {
	ListPresets() ([]model.Preset, error)
	CreatePreset(p model.Preset) error
	DeletePreset(id string) error
}

// DemoService manages the demo dataset lifecycle (install, uninstall, status).
type DemoService struct {
	fs          DemoFileSystem
	presetStore DemoPresetStore
	sampleDir   string
	logger      *logrus.Entry
}

// NewDemoService creates a DemoService.
func NewDemoService(fs DemoFileSystem, presetStore DemoPresetStore, sampleDir string, logger *logrus.Logger) *DemoService {
	return &DemoService{
		fs:          fs,
		presetStore: presetStore,
		sampleDir:   sampleDir,
		logger:      logger.WithField("component", "demo"),
	}
}

// Status returns whether the demo dataset is currently installed.
func (s *DemoService) Status() model.DemoStatus {
	s.logger.Trace("entering Status")
	defer s.logger.Trace("returning from Status")

	demoDir := filepath.Join(s.sampleDir, model.DemoStudyName)
	installed := s.fs.DirectoryExists(demoDir)
	s.logger.WithField("installed", installed).Debug("checked demo status")
	return model.DemoStatus{Installed: installed}
}

// Install creates the demo dataset under sample_dir and seeds the demo preset.
// If the demo data already exists, it is a no-op.
func (s *DemoService) Install() error {
	s.logger.Trace("entering Install")
	defer s.logger.Trace("returning from Install")

	demoDir := filepath.Join(s.sampleDir, model.DemoStudyName)
	if s.fs.DirectoryExists(demoDir) {
		s.logger.Debug("demo dataset already installed, skipping")
		return nil
	}

	// Create the demo study directory
	if err := os.MkdirAll(demoDir, 0755); err != nil {
		s.logger.WithError(err).Error("failed to create demo study directory")
		return fmt.Errorf("creating demo study directory: %w", err)
	}

	// Generate demo checkpoint directories and images
	if err := s.generateDemoImages(demoDir); err != nil {
		// Clean up on failure
		os.RemoveAll(demoDir)
		return err
	}

	// Seed the demo dimension preset
	if err := s.seedDemoPreset(); err != nil {
		s.logger.WithError(err).Warn("failed to seed demo preset, demo images still installed")
		// Don't fail — images are installed even if preset fails
	}

	s.logger.Info("demo dataset installed")
	return nil
}

// Uninstall removes the demo dataset and the demo preset.
func (s *DemoService) Uninstall() error {
	s.logger.Trace("entering Uninstall")
	defer s.logger.Trace("returning from Uninstall")

	// Remove demo study directory
	demoDir := filepath.Join(s.sampleDir, model.DemoStudyName)
	if err := os.RemoveAll(demoDir); err != nil {
		s.logger.WithError(err).Error("failed to remove demo study directory")
		return fmt.Errorf("removing demo study directory: %w", err)
	}
	s.logger.Debug("demo study directory removed")

	// Remove demo preset
	if err := s.removeDemoPreset(); err != nil {
		s.logger.WithError(err).Warn("failed to remove demo preset")
		// Don't fail — directory is removed even if preset removal fails
	}

	s.logger.Info("demo dataset uninstalled")
	return nil
}

// demoCheckpoints defines the fake checkpoint filenames for the demo dataset.
var demoCheckpoints = []string{
	"demo-model-step00001000.safetensors",
	"demo-model-step00002000.safetensors",
	"demo-model-step00003000.safetensors",
}

// demoPrompts defines the prompt_name dimension values.
var demoPrompts = []string{"landscape", "portrait"}

// demoSeeds defines the seed dimension values.
var demoSeeds = []string{"42", "123"}

// demoCFGs defines the cfg dimension values.
var demoCFGs = []string{"1", "7"}

// generateDemoImages creates checkpoint directories with placeholder PNG images.
func (s *DemoService) generateDemoImages(demoDir string) error {
	for _, cpFilename := range demoCheckpoints {
		cpDir := filepath.Join(demoDir, cpFilename)
		if err := os.MkdirAll(cpDir, 0755); err != nil {
			s.logger.WithFields(logrus.Fields{
				"checkpoint": cpFilename,
				"error":      err.Error(),
			}).Error("failed to create checkpoint directory")
			return fmt.Errorf("creating checkpoint directory %s: %w", cpFilename, err)
		}

		for _, prompt := range demoPrompts {
			for _, seed := range demoSeeds {
				for _, cfg := range demoCFGs {
					filename := fmt.Sprintf("prompt_name=%s&seed=%s&cfg=%s&_00001_.png", prompt, seed, cfg)
					imgPath := filepath.Join(cpDir, filename)

					imgData, err := generatePlaceholderPNG(cpFilename, prompt, seed, cfg)
					if err != nil {
						s.logger.WithFields(logrus.Fields{
							"path":  imgPath,
							"error": err.Error(),
						}).Error("failed to generate placeholder PNG")
						return fmt.Errorf("generating placeholder PNG: %w", err)
					}

					if err := os.WriteFile(imgPath, imgData, 0644); err != nil {
						s.logger.WithFields(logrus.Fields{
							"path":  imgPath,
							"error": err.Error(),
						}).Error("failed to write placeholder PNG")
						return fmt.Errorf("writing placeholder PNG: %w", err)
					}
				}
			}
		}
		s.logger.WithField("checkpoint", cpFilename).Debug("demo checkpoint images created")
	}
	return nil
}

// seedDemoPreset creates a demo dimension mapping preset if one doesn't already exist.
func (s *DemoService) seedDemoPreset() error {
	presets, err := s.presetStore.ListPresets()
	if err != nil {
		return fmt.Errorf("listing presets: %w", err)
	}

	// Check if demo preset already exists
	for _, p := range presets {
		if p.Name == model.DemoPresetName {
			s.logger.Debug("demo preset already exists, skipping seed")
			return nil
		}
	}

	now := time.Now().UTC()
	preset := model.Preset{
		ID:   uuid.New().String(),
		Name: model.DemoPresetName,
		Mapping: model.PresetMapping{
			X:      "cfg",
			Y:      "prompt_name",
			Slider: "checkpoint",
			Combos: []string{"seed"},
		},
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := s.presetStore.CreatePreset(preset); err != nil {
		return fmt.Errorf("creating demo preset: %w", err)
	}
	s.logger.WithField("preset_id", preset.ID).Info("demo preset seeded")
	return nil
}

// removeDemoPreset deletes the demo preset by name.
func (s *DemoService) removeDemoPreset() error {
	presets, err := s.presetStore.ListPresets()
	if err != nil {
		return fmt.Errorf("listing presets: %w", err)
	}

	for _, p := range presets {
		if p.Name == model.DemoPresetName {
			if err := s.presetStore.DeletePreset(p.ID); err != nil {
				return fmt.Errorf("deleting demo preset: %w", err)
			}
			s.logger.WithField("preset_id", p.ID).Info("demo preset removed")
			return nil
		}
	}

	s.logger.Debug("no demo preset found to remove")
	return nil
}

// generatePlaceholderPNG creates a small colored PNG image.
// Colors vary by parameters to make different images visually distinguishable.
func generatePlaceholderPNG(checkpoint, prompt, seed, cfg string) ([]byte, error) {
	const size = 64

	// Generate a unique color based on the parameters
	r, g, b := parameterColor(checkpoint, prompt, seed, cfg)
	bgColor := color.RGBA{R: r, G: g, B: b, A: 255}

	img := image.NewRGBA(image.Rect(0, 0, size, size))
	draw.Draw(img, img.Bounds(), &image.Uniform{bgColor}, image.Point{}, draw.Src)

	// Add a simple border
	borderColor := color.RGBA{R: 40, G: 40, B: 40, A: 255}
	for x := 0; x < size; x++ {
		img.Set(x, 0, borderColor)
		img.Set(x, size-1, borderColor)
	}
	for y := 0; y < size; y++ {
		img.Set(0, y, borderColor)
		img.Set(size-1, y, borderColor)
	}

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, fmt.Errorf("encoding PNG: %w", err)
	}
	return buf.Bytes(), nil
}

// parameterColor generates a deterministic color from the image parameters.
func parameterColor(checkpoint, prompt, seed, cfg string) (uint8, uint8, uint8) {
	// Use a simple hash approach for deterministic but varied colors
	combined := checkpoint + "|" + prompt + "|" + seed + "|" + cfg
	var hash uint32
	for _, c := range combined {
		hash = hash*31 + uint32(c)
	}

	// Generate pastel-ish colors (range 80-220 to avoid too dark/light)
	r := uint8(80 + (hash%140))
	g := uint8(80 + ((hash/140)%140))
	b := uint8(80 + ((hash/19600)%140))
	return r, g, b
}
