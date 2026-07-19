package api_test

import (
	"context"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("HealthService", func() {
	var svc *api.HealthService

	BeforeEach(func() {
		svc = api.NewHealthService(50000, []string{"/data/checkpoints"})
	})

	It("returns status ok", func() {
		result, err := svc.Check(context.Background())
		Expect(err).NotTo(HaveOccurred())
		Expect(result).NotTo(BeNil())
		Expect(result.Status).To(Equal("ok"))
	})

	It("exposes the configured max_study_items via Config", func() {
		result, err := svc.Config(context.Background())
		Expect(err).NotTo(HaveOccurred())
		Expect(result).NotTo(BeNil())
		Expect(result.MaxStudyItems).To(Equal(50000))
	})

	// S-173: checkpoint_dirs is surfaced via /api/v1/config so the frontend
	// empty state can name the exact configured directories.
	It("exposes the configured checkpoint_dirs via Config", func() {
		result, err := svc.Config(context.Background())
		Expect(err).NotTo(HaveOccurred())
		Expect(result).NotTo(BeNil())
		Expect(result.CheckpointDirs).To(Equal([]string{"/data/checkpoints"}))
	})
})
