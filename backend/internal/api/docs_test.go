package api_test

import (
	"context"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("DocsService", func() {
	var svc *api.DocsService

	Context("with a valid spec", func() {
		specData := []byte(`{"openapi":"3.0.0","info":{"title":"test","version":"1.0"}}`)

		BeforeEach(func() {
			svc = api.NewDocsService(specData)
		})

		It("returns the OpenAPI spec bytes", func() {
			result, err := svc.Openapi(context.Background())
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(Equal(specData))
		})
	})

	Context("with an empty spec", func() {
		BeforeEach(func() {
			svc = api.NewDocsService([]byte{})
		})

		It("returns empty bytes", func() {
			result, err := svc.Openapi(context.Background())
			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(BeEmpty())
		})
	})
})
