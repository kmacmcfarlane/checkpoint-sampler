package api_test

import (
	"context"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api"
)

var _ = Describe("HealthService", func() {
	var svc *api.HealthService

	BeforeEach(func() {
		svc = api.NewHealthService()
	})

	It("returns status ok", func() {
		result, err := svc.Check(context.Background())
		Expect(err).NotTo(HaveOccurred())
		Expect(result).NotTo(BeNil())
		Expect(result.Status).To(Equal("ok"))
	})
})
