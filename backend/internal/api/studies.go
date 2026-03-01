package api

import (
	"context"
	"fmt"
	"time"

	genstudies "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/studies"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// StudiesService implements the generated studies service interface.
type StudiesService struct {
	svc *service.StudyService
}

// NewStudiesService returns a new StudiesService.
func NewStudiesService(svc *service.StudyService) *StudiesService {
	return &StudiesService{svc: svc}
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
