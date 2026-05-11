package model_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

var _ = Describe("TrainingRunKind", func() {
	Describe("constants", func() {
		It("defines checkpoint kind", func() {
			Expect(string(model.TrainingRunKindCheckpoint)).To(Equal("checkpoint"))
		})

		It("defines LoRA kind", func() {
			Expect(string(model.TrainingRunKindLoRA)).To(Equal("lora"))
		})
	})

	Describe("TrainingRun.Kind field", func() {
		It("defaults to zero value (empty string)", func() {
			run := model.TrainingRun{}
			Expect(run.Kind).To(Equal(model.TrainingRunKind("")))
		})

		It("can be set to checkpoint", func() {
			run := model.TrainingRun{Kind: model.TrainingRunKindCheckpoint}
			Expect(run.Kind).To(Equal(model.TrainingRunKindCheckpoint))
		})

		It("can be set to lora", func() {
			run := model.TrainingRun{Kind: model.TrainingRunKindLoRA}
			Expect(run.Kind).To(Equal(model.TrainingRunKindLoRA))
		})
	})
})
