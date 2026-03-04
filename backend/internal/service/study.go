package service

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// StudyStore defines the persistence operations the study service needs.
type StudyStore interface {
	ListStudies() ([]model.Study, error)
	GetStudy(id string) (model.Study, error)
	// GetStudyByName returns the first study with the given name, excluding the
	// study with excludeID (pass "" to include all studies). Returns
	// sql.ErrNoRows if no matching study is found.
	GetStudyByName(name string, excludeID string) (model.Study, error)
	CreateStudy(s model.Study) error
	UpdateStudy(s model.Study) error
	DeleteStudy(id string) error
}

// StudyService manages study CRUD operations.
type StudyService struct {
	store  StudyStore
	logger *logrus.Entry
}

// NewStudyService creates a StudyService backed by the given store.
func NewStudyService(store StudyStore, logger *logrus.Logger) *StudyService {
	return &StudyService{
		store:  store,
		logger: logger.WithField("component", "study"),
	}
}

// List returns all studies.
func (s *StudyService) List() ([]model.Study, error) {
	s.logger.Trace("entering List")
	defer s.logger.Trace("returning from List")

	studies, err := s.store.ListStudies()
	if err != nil {
		s.logger.WithError(err).Error("failed to list studies")
		return nil, fmt.Errorf("listing studies: %w", err)
	}
	s.logger.WithField("study_count", len(studies)).Debug("studies retrieved from store")
	if studies == nil {
		studies = []model.Study{}
	}
	return studies, nil
}

// Create validates and persists a new study, returning the created study.
func (s *StudyService) Create(name string, promptPrefix string, prompts []model.NamedPrompt, negativePrompt string, steps []int, cfgs []float64, pairs []model.SamplerSchedulerPair, seeds []int64, width int, height int) (model.Study, error) {
	s.logger.WithField("study_name", name).Trace("entering Create")
	defer s.logger.Trace("returning from Create")

	if err := s.validate(name, prompts, steps, cfgs, pairs, seeds, width, height); err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_name": name,
			"error":      err.Error(),
		}).Warn("study validation failed")
		return model.Study{}, err
	}

	// Check for duplicate study name.
	if _, err := s.store.GetStudyByName(name, ""); err == nil {
		s.logger.WithField("study_name", name).Warn("duplicate study name rejected")
		return model.Study{}, fmt.Errorf("a study named %q already exists", name)
	} else if err != sql.ErrNoRows {
		s.logger.WithFields(logrus.Fields{
			"study_name": name,
			"error":      err.Error(),
		}).Error("failed to check for duplicate study name")
		return model.Study{}, fmt.Errorf("checking study name uniqueness: %w", err)
	}

	now := time.Now().UTC()
	st := model.Study{
		ID:                    uuid.New().String(),
		Name:                  name,
		Version:               1,
		PromptPrefix:          promptPrefix,
		Prompts:               prompts,
		NegativePrompt:        negativePrompt,
		Steps:                 steps,
		CFGs:                  cfgs,
		SamplerSchedulerPairs: pairs,
		Seeds:                 seeds,
		Width:                 width,
		Height:                height,
		CreatedAt:             now,
		UpdatedAt:             now,
	}
	if err := s.store.CreateStudy(st); err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id":   st.ID,
			"study_name": name,
			"error":      err.Error(),
		}).Error("failed to create study")
		return model.Study{}, fmt.Errorf("creating study: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"study_id":              st.ID,
		"study_name":            name,
		"images_per_checkpoint": st.ImagesPerCheckpoint(),
	}).Info("study created")
	return st, nil
}

// Update modifies an existing study.
func (s *StudyService) Update(id string, name string, promptPrefix string, prompts []model.NamedPrompt, negativePrompt string, steps []int, cfgs []float64, pairs []model.SamplerSchedulerPair, seeds []int64, width int, height int) (model.Study, error) {
	s.logger.WithFields(logrus.Fields{
		"study_id":   id,
		"study_name": name,
	}).Trace("entering Update")
	defer s.logger.Trace("returning from Update")

	if err := s.validate(name, prompts, steps, cfgs, pairs, seeds, width, height); err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": id,
			"error":    err.Error(),
		}).Warn("study validation failed")
		return model.Study{}, err
	}

	// Check for duplicate study name, excluding the study being updated.
	if _, err := s.store.GetStudyByName(name, id); err == nil {
		s.logger.WithFields(logrus.Fields{
			"study_id":   id,
			"study_name": name,
		}).Warn("duplicate study name rejected on update")
		return model.Study{}, fmt.Errorf("a study named %q already exists", name)
	} else if err != sql.ErrNoRows {
		s.logger.WithFields(logrus.Fields{
			"study_id":   id,
			"study_name": name,
			"error":      err.Error(),
		}).Error("failed to check for duplicate study name on update")
		return model.Study{}, fmt.Errorf("checking study name uniqueness: %w", err)
	}

	existing, err := s.store.GetStudy(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("study_id", id).Debug("study not found")
		return model.Study{}, fmt.Errorf("study %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": id,
			"error":    err.Error(),
		}).Error("failed to fetch study for update")
		return model.Study{}, fmt.Errorf("fetching study: %w", err)
	}
	s.logger.WithField("study_id", id).Debug("fetched existing study from store")

	existing.Name = name
	existing.PromptPrefix = promptPrefix
	existing.Prompts = prompts
	existing.NegativePrompt = negativePrompt
	existing.Steps = steps
	existing.CFGs = cfgs
	existing.SamplerSchedulerPairs = pairs
	existing.Seeds = seeds
	existing.Width = width
	existing.Height = height
	existing.Version = existing.Version + 1
	existing.UpdatedAt = time.Now().UTC()

	if err := s.store.UpdateStudy(existing); err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id":   id,
			"study_name": name,
			"error":      err.Error(),
		}).Error("failed to update study")
		return model.Study{}, fmt.Errorf("updating study: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"study_id":              id,
		"study_name":            name,
		"version":               existing.Version,
		"images_per_checkpoint": existing.ImagesPerCheckpoint(),
	}).Info("study updated")
	return existing, nil
}

// Delete removes a study by ID.
func (s *StudyService) Delete(id string) error {
	s.logger.WithField("study_id", id).Trace("entering Delete")
	defer s.logger.Trace("returning from Delete")

	err := s.store.DeleteStudy(id)
	if err == sql.ErrNoRows {
		s.logger.WithField("study_id", id).Debug("study not found for deletion")
		return fmt.Errorf("study %s not found", id)
	}
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": id,
			"error":    err.Error(),
		}).Error("failed to delete study")
		return fmt.Errorf("deleting study: %w", err)
	}
	s.logger.WithField("study_id", id).Info("study deleted")
	return nil
}

// validate checks that a study's fields meet the requirements.
func (s *StudyService) validate(name string, prompts []model.NamedPrompt, steps []int, cfgs []float64, pairs []model.SamplerSchedulerPair, seeds []int64, width int, height int) error {
	if name == "" {
		return fmt.Errorf("study name must not be empty")
	}
	if len(prompts) == 0 {
		return fmt.Errorf("at least one prompt is required")
	}
	seenPromptNames := make(map[string]bool, len(prompts))
	for i, p := range prompts {
		if p.Name == "" {
			return fmt.Errorf("prompt %d name must not be empty", i)
		}
		if p.Text == "" {
			return fmt.Errorf("prompt %d text must not be empty", i)
		}
		if seenPromptNames[p.Name] {
			return fmt.Errorf("duplicate prompt name %q", p.Name)
		}
		seenPromptNames[p.Name] = true
	}
	if len(steps) == 0 {
		return fmt.Errorf("at least one step count is required")
	}
	seenSteps := make(map[int]bool, len(steps))
	for i, step := range steps {
		if step <= 0 {
			return fmt.Errorf("step %d must be positive", i)
		}
		if seenSteps[step] {
			return fmt.Errorf("duplicate step value %d", step)
		}
		seenSteps[step] = true
	}
	if len(cfgs) == 0 {
		return fmt.Errorf("at least one CFG value is required")
	}
	seenCFGs := make(map[float64]bool, len(cfgs))
	for i, cfg := range cfgs {
		if cfg <= 0 {
			return fmt.Errorf("CFG %d must be positive", i)
		}
		if seenCFGs[cfg] {
			return fmt.Errorf("duplicate CFG value %g", cfg)
		}
		seenCFGs[cfg] = true
	}
	if len(pairs) == 0 {
		return fmt.Errorf("at least one sampler/scheduler pair is required")
	}
	type pairKey struct{ sampler, scheduler string }
	seenPairs := make(map[pairKey]bool, len(pairs))
	for i, pair := range pairs {
		if pair.Sampler == "" {
			return fmt.Errorf("pair %d sampler must not be empty", i)
		}
		if pair.Scheduler == "" {
			return fmt.Errorf("pair %d scheduler must not be empty", i)
		}
		key := pairKey{pair.Sampler, pair.Scheduler}
		if seenPairs[key] {
			return fmt.Errorf("duplicate sampler/scheduler pair %q/%q", pair.Sampler, pair.Scheduler)
		}
		seenPairs[key] = true
	}
	seenSeeds := make(map[int64]bool, len(seeds))
	if len(seeds) == 0 {
		return fmt.Errorf("at least one seed is required")
	}
	for _, seed := range seeds {
		if seenSeeds[seed] {
			return fmt.Errorf("duplicate seed value %d", seed)
		}
		seenSeeds[seed] = true
	}
	if width <= 0 {
		return fmt.Errorf("width must be positive")
	}
	if height <= 0 {
		return fmt.Errorf("height must be positive")
	}
	return nil
}
