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

	now := time.Now().UTC()
	st := model.Study{
		ID:                    uuid.New().String(),
		Name:                  name,
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
	for i, p := range prompts {
		if p.Name == "" {
			return fmt.Errorf("prompt %d name must not be empty", i)
		}
		if p.Text == "" {
			return fmt.Errorf("prompt %d text must not be empty", i)
		}
	}
	if len(steps) == 0 {
		return fmt.Errorf("at least one step count is required")
	}
	for i, step := range steps {
		if step <= 0 {
			return fmt.Errorf("step %d must be positive", i)
		}
	}
	if len(cfgs) == 0 {
		return fmt.Errorf("at least one CFG value is required")
	}
	for i, cfg := range cfgs {
		if cfg <= 0 {
			return fmt.Errorf("CFG %d must be positive", i)
		}
	}
	if len(pairs) == 0 {
		return fmt.Errorf("at least one sampler/scheduler pair is required")
	}
	for i, pair := range pairs {
		if pair.Sampler == "" {
			return fmt.Errorf("pair %d sampler must not be empty", i)
		}
		if pair.Scheduler == "" {
			return fmt.Errorf("pair %d scheduler must not be empty", i)
		}
	}
	if len(seeds) == 0 {
		return fmt.Errorf("at least one seed is required")
	}
	if width <= 0 {
		return fmt.Errorf("width must be positive")
	}
	if height <= 0 {
		return fmt.Errorf("height must be positive")
	}
	return nil
}
