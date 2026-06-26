package api

import (
	"context"

	genbasemodels "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/base_models"
)

// BaseModelLister lists base model files from the configured directory.
type BaseModelLister interface {
	ListBaseModels() ([]string, error)
}

// BaseModelsService implements the generated base_models Goa service interface.
type BaseModelsService struct {
	lister BaseModelLister
}

// NewBaseModelsService creates a new BaseModelsService.
func NewBaseModelsService(lister BaseModelLister) *BaseModelsService {
	return &BaseModelsService{lister: lister}
}

// List implements basemodels.Service.
func (s *BaseModelsService) List(ctx context.Context) (*genbasemodels.BaseModelsResult, error) {
	models, err := s.lister.ListBaseModels()
	if err != nil {
		return nil, genbasemodels.MakeInternalError(err)
	}
	return &genbasemodels.BaseModelsResult{
		Models: models,
	}, nil
}
