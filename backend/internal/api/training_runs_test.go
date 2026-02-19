package api_test

import (
	"context"
	"regexp"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/model"
)

var _ = Describe("TrainingRunsService", func() {
	Describe("List", func() {
		It("returns empty slice when no training runs configured", func() {
			svc := api.NewTrainingRunsService(nil)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(0))
		})

		It("returns all configured training runs with correct IDs", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "run-alpha",
					Pattern: regexp.MustCompile(`^alpha/.+`),
				},
				{
					Name:    "run-beta",
					Pattern: regexp.MustCompile(`^beta/.+`),
				},
			}
			svc := api.NewTrainingRunsService(runs)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(2))
			Expect(result[0].ID).To(Equal(0))
			Expect(result[0].Name).To(Equal("run-alpha"))
			Expect(result[0].Pattern).To(Equal(`^alpha/.+`))
			Expect(result[1].ID).To(Equal(1))
			Expect(result[1].Name).To(Equal("run-beta"))
			Expect(result[1].Pattern).To(Equal(`^beta/.+`))
		})

		It("includes dimension configs in the response", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:    "with-dims",
					Pattern: regexp.MustCompile(`^test`),
					Dimensions: []model.DimensionConfig{
						{
							Name:    "step",
							Type:    model.DimensionTypeInt,
							Pattern: regexp.MustCompile(`-steps-(\d+)-`),
						},
						{
							Name:    "checkpoint",
							Type:    model.DimensionTypeString,
							Pattern: regexp.MustCompile(`([^/]+)$`),
						},
					},
				},
			}
			svc := api.NewTrainingRunsService(runs)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
			Expect(result[0].Dimensions).To(HaveLen(2))

			Expect(result[0].Dimensions[0].Name).To(Equal("step"))
			Expect(result[0].Dimensions[0].Type).To(Equal("int"))
			Expect(result[0].Dimensions[0].Pattern).To(Equal(`-steps-(\d+)-`))

			Expect(result[0].Dimensions[1].Name).To(Equal("checkpoint"))
			Expect(result[0].Dimensions[1].Type).To(Equal("string"))
			Expect(result[0].Dimensions[1].Pattern).To(Equal(`([^/]+)$`))
		})

		It("returns empty dimensions slice when training run has no dimensions", func() {
			runs := []model.TrainingRunConfig{
				{
					Name:       "no-dims",
					Pattern:    regexp.MustCompile(`^test`),
					Dimensions: nil,
				},
			}
			svc := api.NewTrainingRunsService(runs)

			result, err := svc.List(context.Background())

			Expect(err).NotTo(HaveOccurred())
			Expect(result[0].Dimensions).To(HaveLen(0))
		})
	})
})
