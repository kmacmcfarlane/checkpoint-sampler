package api

import (
	"context"
	"fmt"
	"time"

	genstudies "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/studies"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// TrainingRunDiscoverer returns training runs for a given discovery source.
type TrainingRunDiscoverer interface {
	Discover() ([]model.TrainingRun, error)
}

// StudiesService implements the generated studies service interface.
type StudiesService struct {
	svc          *service.StudyService
	availability *service.StudyAvailabilityService
	discovery    TrainingRunDiscoverer
}

// NewStudiesService returns a new StudiesService.
func NewStudiesService(svc *service.StudyService, availability *service.StudyAvailabilityService, discovery TrainingRunDiscoverer) *StudiesService {
	return &StudiesService{svc: svc, availability: availability, discovery: discovery}
}

// List returns all saved studies.
func (s *StudiesService) List(ctx context.Context) ([]*genstudies.StudyResponse, error) {
	studies, err := s.svc.List()
	if err != nil {
		return nil, genstudies.MakeInternalError(fmt.Errorf("listing studies: %w", err))
	}
	result := make([]*genstudies.StudyResponse, len(studies))
	for i, st := range studies {
		result[i] = studyToResponse(st)
	}
	return result, nil
}

// Create creates a new study.
func (s *StudiesService) Create(ctx context.Context, p *genstudies.CreateStudyPayload) (*genstudies.StudyResponse, error) {
	prompts := make([]model.NamedPrompt, len(p.Prompts))
	for i, np := range p.Prompts {
		prompts[i] = model.NamedPrompt{
			Name: np.Name,
			Text: np.Text,
		}
	}

	pairs := make([]model.SamplerSchedulerPair, len(p.SamplerSchedulerPairs))
	for i, pair := range p.SamplerSchedulerPairs {
		pairs[i] = model.SamplerSchedulerPair{
			Sampler:   pair.Sampler,
			Scheduler: pair.Scheduler,
		}
	}

	study, err := s.svc.Create(
		p.Name,
		p.PromptPrefix,
		prompts,
		p.NegativePrompt,
		p.Steps,
		p.Cfgs,
		pairs,
		p.Seeds,
		p.Width,
		p.Height,
	)
	if err != nil {
		return nil, genstudies.MakeInvalidPayload(fmt.Errorf("creating study: %w", err))
	}
	return studyToResponse(study), nil
}

// Update modifies an existing study.
func (s *StudiesService) Update(ctx context.Context, p *genstudies.UpdateStudyPayload) (*genstudies.StudyResponse, error) {
	prompts := make([]model.NamedPrompt, len(p.Prompts))
	for i, np := range p.Prompts {
		prompts[i] = model.NamedPrompt{
			Name: np.Name,
			Text: np.Text,
		}
	}

	pairs := make([]model.SamplerSchedulerPair, len(p.SamplerSchedulerPairs))
	for i, pair := range p.SamplerSchedulerPairs {
		pairs[i] = model.SamplerSchedulerPair{
			Sampler:   pair.Sampler,
			Scheduler: pair.Scheduler,
		}
	}

	study, err := s.svc.Update(
		p.ID,
		p.Name,
		p.PromptPrefix,
		prompts,
		p.NegativePrompt,
		p.Steps,
		p.Cfgs,
		pairs,
		p.Seeds,
		p.Width,
		p.Height,
	)
	if err != nil {
		if isNotFound(err) {
			return nil, genstudies.MakeNotFound(err)
		}
		return nil, genstudies.MakeInvalidPayload(fmt.Errorf("updating study: %w", err))
	}
	return studyToResponse(study), nil
}

// Delete removes a study.
func (s *StudiesService) Delete(ctx context.Context, p *genstudies.DeletePayload) error {
	err := s.svc.Delete(p.ID)
	if err != nil {
		if isNotFound(err) {
			return genstudies.MakeNotFound(err)
		}
		return genstudies.MakeInternalError(fmt.Errorf("deleting study: %w", err))
	}
	return nil
}

// Availability returns per-study version availability for a given training run.
func (s *StudiesService) Availability(ctx context.Context, p *genstudies.AvailabilityPayload) ([]*genstudies.StudyAvailabilityResponse, error) {
	studies, err := s.svc.List()
	if err != nil {
		return nil, genstudies.MakeInternalError(fmt.Errorf("listing studies: %w", err))
	}

	runs, err := s.discovery.Discover()
	if err != nil {
		return nil, genstudies.MakeInternalError(fmt.Errorf("discovering training runs: %w", err))
	}

	if p.TrainingRunID < 0 || p.TrainingRunID >= len(runs) {
		return nil, genstudies.MakeNotFound(fmt.Errorf("training run %d not found", p.TrainingRunID))
	}

	tr := runs[p.TrainingRunID]

	availabilities, err := s.availability.GetAvailability(studies, tr)
	if err != nil {
		return nil, genstudies.MakeInternalError(fmt.Errorf("checking study availability: %w", err))
	}

	result := make([]*genstudies.StudyAvailabilityResponse, len(availabilities))
	for i, a := range availabilities {
		versions := make([]*genstudies.StudyVersionInfoResponse, len(a.Versions))
		for j, v := range a.Versions {
			versions[j] = &genstudies.StudyVersionInfoResponse{
				Version:    v.Version,
				HasSamples: v.HasSamples,
			}
		}
		result[i] = &genstudies.StudyAvailabilityResponse{
			StudyID:   a.StudyID,
			StudyName: a.StudyName,
			Versions:  versions,
		}
	}

	return result, nil
}

func studyToResponse(s model.Study) *genstudies.StudyResponse {
	prompts := make([]*genstudies.NamedPrompt, len(s.Prompts))
	for i, np := range s.Prompts {
		prompts[i] = &genstudies.NamedPrompt{
			Name: np.Name,
			Text: np.Text,
		}
	}

	pairs := make([]*genstudies.SamplerSchedulerPair, len(s.SamplerSchedulerPairs))
	for i, pair := range s.SamplerSchedulerPairs {
		pairs[i] = &genstudies.SamplerSchedulerPair{
			Sampler:   pair.Sampler,
			Scheduler: pair.Scheduler,
		}
	}

	return &genstudies.StudyResponse{
		ID:                    s.ID,
		Name:                  s.Name,
		Version:               s.Version,
		PromptPrefix:          s.PromptPrefix,
		Prompts:               prompts,
		NegativePrompt:        s.NegativePrompt,
		Steps:                 s.Steps,
		Cfgs:                  s.CFGs,
		SamplerSchedulerPairs: pairs,
		Seeds:                 s.Seeds,
		Width:                 s.Width,
		Height:                s.Height,
		ImagesPerCheckpoint:   s.ImagesPerCheckpoint(),
		CreatedAt:             s.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:             s.UpdatedAt.UTC().Format(time.RFC3339),
	}
}
