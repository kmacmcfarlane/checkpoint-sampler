package service_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

var _ = Describe("TrainingRunID / FindTrainingRunByID (S-155)", func() {
	Describe("TrainingRunID", func() {
		It("is stable for the same run identity (name) regardless of position", func() {
			tr := model.TrainingRun{Name: "qwen/psai4rt-v0.3.0-no-reg"}
			Expect(service.TrainingRunID(tr)).To(Equal(service.TrainingRunID(tr)))
		})

		It("is URL-safe (no '+', '/', or '=' characters)", func() {
			// A name that would produce '+' and '/' under standard base64.
			tr := model.TrainingRun{Name: "study/sub?dir>>name"}
			id := service.TrainingRunID(tr)
			Expect(id).NotTo(ContainSubstring("+"))
			Expect(id).NotTo(ContainSubstring("/"))
			Expect(id).NotTo(ContainSubstring("="))
		})

		It("differs between runs with different names", func() {
			a := model.TrainingRun{Name: "run-a"}
			b := model.TrainingRun{Name: "run-b"}
			Expect(service.TrainingRunID(a)).NotTo(Equal(service.TrainingRunID(b)))
		})
	})

	Describe("FindTrainingRunByID across reordered discovery", func() {
		// AC1: Selecting a training run, then a rescan that changes discovery order,
		// then resolving by the held id must target the SAME run as before.
		It("resolves to the same run even when the discovery order changes", func() {
			// Initial discovery snapshot.
			runsBefore := []model.TrainingRun{
				{Name: "alpha"},
				{Name: "bravo"},
				{Name: "charlie"},
			}

			// Hold the id of the run the user selected ("bravo").
			heldID := service.TrainingRunID(runsBefore[1])

			// A rescan reorders discovery and inserts a new run at the front,
			// which under the old positional-index scheme would have shifted
			// "bravo" to a different index.
			runsAfter := []model.TrainingRun{
				{Name: "zulu-new"},
				{Name: "charlie"},
				{Name: "bravo"},
				{Name: "alpha"},
			}

			resolved, ok := service.FindTrainingRunByID(runsAfter, heldID)
			Expect(ok).To(BeTrue())
			Expect(resolved.Name).To(Equal("bravo"))
		})

		It("returns ok=false for an id that no longer matches any run", func() {
			runs := []model.TrainingRun{{Name: "alpha"}}
			_, ok := service.FindTrainingRunByID(runs, "bm9uZXhpc3RlbnQ")
			Expect(ok).To(BeFalse())
		})
	})
})
