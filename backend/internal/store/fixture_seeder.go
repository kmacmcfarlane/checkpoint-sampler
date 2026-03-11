package store

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// E2EFixtureStudyID is the fixed UUID used for the E2E fixture study.
// This must match the fixture directory structure under test-fixtures/samples/.
// The test reset endpoint seeds this study into the DB after every reset so that
// regen-confirmation.spec.ts E2E tests can find a study with existing samples.
const E2EFixtureStudyID = "e2efixture-0000-0000-0000-000000000001"

// E2EFixtureStudyName is the human-readable name of the fixture study.
const E2EFixtureStudyName = "E2E Fixture Study"

// E2EFixtureTrainingRunName is the training run name that has fixture samples.
const E2EFixtureTrainingRunName = "my-model"

// E2ESlashFixtureStudyID is the fixed UUID for the slash-training-run fixture study.
// Used by B-088 E2E tests to verify slash sanitization in directory paths.
const E2ESlashFixtureStudyID = "e2efixture-0000-0000-0000-000000000002"

// E2ESlashFixtureStudyName is the human-readable name of the slash fixture study.
const E2ESlashFixtureStudyName = "E2E Slash Fixture Study"

// E2ESlashFixtureTrainingRunName is a training run name containing a forward slash.
// This simulates real-world training runs like "qwen/Qwen2-VL" whose checkpoints
// live in a subdirectory of the checkpoint_dir.
// The filesystem directory is the sanitized form: "test-run_my-model".
const E2ESlashFixtureTrainingRunName = "test-run/my-model"

// e2eFixtureCheckpoints lists the checkpoint filenames whose sample dirs are seeded.
var e2eFixtureCheckpoints = []string{
	"my-model-step00001000.safetensors",
	"my-model-step00002000.safetensors",
}

// e2eSlashFixtureCheckpoints lists the checkpoint filenames for the slash training run fixture.
// These match the files in test-fixtures/checkpoints/test-run/.
var e2eSlashFixtureCheckpoints = []string{
	"my-model-step00001000.safetensors",
	"my-model-step00002000.safetensors",
}

// e2eFixturePNGFilenames lists the PNG filenames created inside each checkpoint dir.
// Matches: 2 prompts × 1 step × 1 cfg × 1 sampler/scheduler pair × 1 seed = 2 images/checkpoint.
var e2eFixturePNGFilenames = []string{
	"prompt_name=landscape&seed=42&cfg=7&_00001_.png",
	"prompt_name=portrait&seed=42&cfg=7&_00001_.png",
}

// FixtureSeeder seeds E2E fixture data (studies + sample directories) into the
// database and filesystem after a test reset. This ensures deterministic test
// conditions for specs that validate regeneration confirmation logic.
type FixtureSeeder struct {
	store     *Store
	sampleDir string
	logger    *logrus.Entry
}

// NewFixtureSeeder creates a FixtureSeeder backed by the given store.
func NewFixtureSeeder(store *Store, sampleDir string, logger *logrus.Logger) *FixtureSeeder {
	return &FixtureSeeder{
		store:     store,
		sampleDir: sampleDir,
		logger:    logger.WithField("component", "fixture_seeder"),
	}
}

// SeedFixtures seeds the E2E fixture study and sample directories.
// It is called by the test reset endpoint after every DB reset.
func (s *FixtureSeeder) SeedFixtures() error {
	s.logger.Info("seeding E2E fixture study and sample directories")

	if err := s.seedFixtureStudy(); err != nil {
		return fmt.Errorf("seeding fixture study: %w", err)
	}

	if err := s.seedFixtureSampleDirs(); err != nil {
		return fmt.Errorf("seeding fixture sample directories: %w", err)
	}

	if err := s.seedSlashFixtureStudy(); err != nil {
		return fmt.Errorf("seeding slash fixture study: %w", err)
	}

	if err := s.seedSlashFixtureSampleDirs(); err != nil {
		return fmt.Errorf("seeding slash fixture sample directories: %w", err)
	}

	s.logger.Info("E2E fixture seeding completed")
	return nil
}

// seedFixtureStudy inserts the fixture study into the database.
// The study has 2 prompts × 1 step × 1 cfg × 1 sampler/scheduler pair × 1 seed = 2 images/checkpoint.
func (s *FixtureSeeder) seedFixtureStudy() error {
	now := time.Now().UTC()
	study := model.Study{
		ID:   E2EFixtureStudyID,
		Name: E2EFixtureStudyName,
		Prompts: []model.NamedPrompt{
			{Name: "landscape", Text: "a beautiful landscape"},
			{Name: "portrait", Text: "a portrait"},
		},
		Steps:                 []int{1},
		CFGs:                  []float64{7.0},
		SamplerSchedulerPairs: []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "normal"}},
		Seeds:                 []int64{42},
		Width:                 512,
		Height:                512,
		WorkflowTemplate:      "test-workflow.json",
		VAE:                   "test-vae.safetensors",
		TextEncoder:           "test-clip.safetensors",
		CreatedAt:             now,
		UpdatedAt:             now,
	}

	if err := s.store.CreateStudy(study); err != nil {
		s.logger.WithError(err).Error("failed to seed fixture study")
		return fmt.Errorf("creating fixture study: %w", err)
	}

	s.logger.WithFields(logrus.Fields{
		"study_id":   E2EFixtureStudyID,
		"study_name": E2EFixtureStudyName,
	}).Info("fixture study seeded")
	return nil
}

// seedFixtureSampleDirs creates the sample directory structure for the fixture
// study under {sampleDir}/{sanitizedTrainingRunName}/{studyID}/{checkpointFilename}/.
// Each checkpoint directory gets the expected number of empty PNG placeholder files.
func (s *FixtureSeeder) seedFixtureSampleDirs() error {
	sanitizedRunName := fileformat.SanitizeTrainingRunName(E2EFixtureTrainingRunName)
	for _, cpFilename := range e2eFixtureCheckpoints {
		cpDir := filepath.Join(s.sampleDir, sanitizedRunName, E2EFixtureStudyID, cpFilename)
		if err := os.MkdirAll(cpDir, 0755); err != nil {
			return fmt.Errorf("creating fixture sample dir %s: %w", cpDir, err)
		}

		for _, pngName := range e2eFixturePNGFilenames {
			pngPath := filepath.Join(cpDir, pngName)
			// Create minimal valid PNG (89 bytes: PNG signature + IHDR + IDAT + IEND)
			if err := os.WriteFile(pngPath, minimalPNG(), 0644); err != nil {
				return fmt.Errorf("creating fixture PNG %s: %w", pngPath, err)
			}
		}

		s.logger.WithFields(logrus.Fields{
			"checkpoint_dir": cpDir,
			"png_count":      len(e2eFixturePNGFilenames),
		}).Debug("fixture sample directory seeded")
	}
	return nil
}

// seedSlashFixtureStudy inserts the slash-fixture study into the database.
// This study is associated with the "test-run/my-model" training run (which has
// a slash in its name) and exercises the B-088 slash sanitization code path.
func (s *FixtureSeeder) seedSlashFixtureStudy() error {
	now := time.Now().UTC()
	study := model.Study{
		ID:   E2ESlashFixtureStudyID,
		Name: E2ESlashFixtureStudyName,
		Prompts: []model.NamedPrompt{
			{Name: "landscape", Text: "a beautiful landscape"},
			{Name: "portrait", Text: "a portrait"},
		},
		Steps:                 []int{1},
		CFGs:                  []float64{7.0},
		SamplerSchedulerPairs: []model.SamplerSchedulerPair{{Sampler: "euler", Scheduler: "normal"}},
		Seeds:                 []int64{42},
		Width:                 512,
		Height:                512,
		WorkflowTemplate:      "test-workflow.json",
		VAE:                   "test-vae.safetensors",
		TextEncoder:           "test-clip.safetensors",
		CreatedAt:             now,
		UpdatedAt:             now,
	}

	if err := s.store.CreateStudy(study); err != nil {
		s.logger.WithError(err).Error("failed to seed slash fixture study")
		return fmt.Errorf("creating slash fixture study: %w", err)
	}

	s.logger.WithFields(logrus.Fields{
		"study_id":             E2ESlashFixtureStudyID,
		"study_name":           E2ESlashFixtureStudyName,
		"training_run_name":    E2ESlashFixtureTrainingRunName,
	}).Info("slash fixture study seeded")
	return nil
}

// seedSlashFixtureSampleDirs creates sample directories for the slash-containing
// training run fixture. The training run name "test-run/my-model" is sanitized to
// "test-run_my-model" for the filesystem path, demonstrating the B-088 fix.
// Layout: {sampleDir}/test-run_my-model/{studyID}/{checkpointFilename}/
func (s *FixtureSeeder) seedSlashFixtureSampleDirs() error {
	// Sanitize the training run name: "test-run/my-model" → "test-run_my-model"
	sanitizedRunName := fileformat.SanitizeTrainingRunName(E2ESlashFixtureTrainingRunName)
	for _, cpFilename := range e2eSlashFixtureCheckpoints {
		cpDir := filepath.Join(s.sampleDir, sanitizedRunName, E2ESlashFixtureStudyID, cpFilename)
		if err := os.MkdirAll(cpDir, 0755); err != nil {
			return fmt.Errorf("creating slash fixture sample dir %s: %w", cpDir, err)
		}

		for _, pngName := range e2eFixturePNGFilenames {
			pngPath := filepath.Join(cpDir, pngName)
			// Create minimal valid PNG (89 bytes: PNG signature + IHDR + IDAT + IEND)
			if err := os.WriteFile(pngPath, minimalPNG(), 0644); err != nil {
				return fmt.Errorf("creating slash fixture PNG %s: %w", pngPath, err)
			}
		}

		s.logger.WithFields(logrus.Fields{
			"training_run":   E2ESlashFixtureTrainingRunName,
			"sanitized_name": sanitizedRunName,
			"checkpoint_dir": cpDir,
			"png_count":      len(e2eFixturePNGFilenames),
		}).Debug("slash fixture sample directory seeded")
	}
	return nil
}

// minimalPNG returns the bytes of a 1×1 transparent PNG image.
// This is the smallest valid PNG that passes format checks, used for fixture files.
func minimalPNG() []byte {
	return []byte{
		// PNG signature
		0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
		// IHDR chunk: 1x1 px, 8-bit RGBA
		0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
		0x89,
		// IDAT chunk: compressed pixel data (1x1 transparent pixel)
		0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41, 0x54,
		0x78, 0x9C, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00,
		0x01, 0xE5, 0x27, 0xDE, 0xFC,
		// IEND chunk
		0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
		0xAE, 0x42, 0x60, 0x82,
	}
}
