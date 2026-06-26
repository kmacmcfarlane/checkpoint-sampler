package api_test

import (
	"context"
	"errors"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	goa "goa.design/goa/v3/pkg"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	genbasemodels "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/base_models"
)

// fakeBaseModelLister implements api.BaseModelLister for testing.
type fakeBaseModelLister struct {
	models []string
	err    error
}

func (f *fakeBaseModelLister) ListBaseModels() ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.models, nil
}

var _ = Describe("BaseModelsService", func() {
	It("returns models from the lister", func() {
		lister := &fakeBaseModelLister{
			models: []string{"flux1-dev.safetensors", "sdxl-base.safetensors"},
		}
		svc := api.NewBaseModelsService(lister)

		result, err := svc.List(context.Background())
		Expect(err).NotTo(HaveOccurred())
		Expect(result).To(Equal(&genbasemodels.BaseModelsResult{
			Models: []string{"flux1-dev.safetensors", "sdxl-base.safetensors"},
		}))
	})

	It("returns empty models list", func() {
		lister := &fakeBaseModelLister{
			models: []string{},
		}
		svc := api.NewBaseModelsService(lister)

		result, err := svc.List(context.Background())
		Expect(err).NotTo(HaveOccurred())
		Expect(result.Models).To(BeEmpty())
	})

	It("returns internal_error on lister failure", func() {
		lister := &fakeBaseModelLister{
			err: errors.New("permission denied"),
		}
		svc := api.NewBaseModelsService(lister)

		_, err := svc.List(context.Background())
		Expect(err).To(HaveOccurred())
		Expect(err.Error()).To(ContainSubstring("permission denied"))
		// R-016: scan failures map to the canonical internal_error (500) code.
		serr, ok := err.(*goa.ServiceError)
		Expect(ok).To(BeTrue(), "expected a goa.ServiceError")
		Expect(serr.Name).To(Equal("internal_error"))
	})
})
