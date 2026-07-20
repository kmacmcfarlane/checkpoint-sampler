package model_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// item is a terse constructor for the fields AggregateItemProgress actually reads.
func item(checkpoint string, status model.SampleJobItemStatus, errMsg string) model.SampleJobItem {
	return model.SampleJobItem{
		CheckpointFilename: checkpoint,
		Status:             status,
		ErrorMessage:       errMsg,
	}
}

var _ = Describe("AggregateItemProgress", func() {
	// AC: Checkpoint progress aggregation consolidated into one shared helper
	// used by GetProgress, broadcastJobProgress, and ListJobsProgress.

	Context("with a mixed fixture job", func() {
		// ckpt-a: fully complete. ckpt-b: partially done (the "current" checkpoint).
		// ckpt-c: has failures. ckpt-d: failed with no error message recorded.
		var agg model.JobProgressAggregate

		BeforeEach(func() {
			agg = model.AggregateItemProgress([]model.SampleJobItem{
				item("ckpt-a", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-a", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-b", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-b", model.SampleJobItemStatusPending, ""),
				item("ckpt-c", model.SampleJobItemStatusFailed, "boom"),
				item("ckpt-c", model.SampleJobItemStatusSkipped, "boom"),
				item("ckpt-c", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-d", model.SampleJobItemStatusFailed, ""),
			})
		})

		It("counts skipped items as failed", func() {
			Expect(agg.Progress.ItemCounts).To(Equal(model.ItemStatusCounts{
				Completed: 4,
				Failed:    3,
				Pending:   1,
			}))
		})

		It("counts only fully-successful checkpoints as completed", func() {
			Expect(agg.Progress.CheckpointsCompleted).To(Equal(1))
			Expect(agg.Progress.TotalCheckpoints).To(Equal(4))
			Expect(agg.CompletedCheckpoints).To(Equal([]string{"ckpt-a"}))
		})

		It("reports the first unfinished checkpoint as current", func() {
			Expect(agg.Progress.CurrentCheckpoint).To(Equal("ckpt-b"))
			Expect(agg.Progress.CurrentCheckpointProgress).To(Equal(1))
			Expect(agg.Progress.CurrentCheckpointTotal).To(Equal(2))
		})

		It("deduplicates error messages per checkpoint and falls back to 'unknown error'", func() {
			Expect(agg.Progress.FailedItemDetails).To(Equal([]model.FailedItemDetail{
				{CheckpointFilename: "ckpt-c", ErrorMessage: "boom"},
				{CheckpointFilename: "ckpt-d", ErrorMessage: "unknown error"},
			}))
		})

		It("produces identical output across repeated calls regardless of input order", func() {
			// Deterministic ordering is what the three former copies drifted on.
			reversed := []model.SampleJobItem{
				item("ckpt-d", model.SampleJobItemStatusFailed, ""),
				item("ckpt-c", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-c", model.SampleJobItemStatusSkipped, "boom"),
				item("ckpt-c", model.SampleJobItemStatusFailed, "boom"),
				item("ckpt-b", model.SampleJobItemStatusPending, ""),
				item("ckpt-b", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-a", model.SampleJobItemStatusCompleted, ""),
				item("ckpt-a", model.SampleJobItemStatusCompleted, ""),
			}
			for i := 0; i < 5; i++ {
				Expect(model.AggregateItemProgress(reversed)).To(Equal(agg))
			}
		})
	})

	It("carries structured error detail through to the failed items", func() {
		agg := model.AggregateItemProgress([]model.SampleJobItem{
			{
				CheckpointFilename: "ckpt",
				Status:             model.SampleJobItemStatusFailed,
				ErrorMessage:       "OOM",
				ExceptionType:      "RuntimeError",
				NodeType:           "KSampler",
				Traceback:          "line 1",
			},
		})
		Expect(agg.Progress.FailedItemDetails).To(Equal([]model.FailedItemDetail{{
			CheckpointFilename: "ckpt",
			ErrorMessage:       "OOM",
			ExceptionType:      "RuntimeError",
			NodeType:           "KSampler",
			Traceback:          "line 1",
		}}))
	})

	It("returns a zero-valued aggregate with a non-nil detail slice for no items", func() {
		agg := model.AggregateItemProgress(nil)
		Expect(agg.Progress.TotalCheckpoints).To(BeZero())
		Expect(agg.Progress.CurrentCheckpoint).To(BeEmpty())
		// Non-nil so the API serializes [] rather than null.
		Expect(agg.Progress.FailedItemDetails).ToNot(BeNil())
		Expect(agg.Progress.FailedItemDetails).To(BeEmpty())
	})
})

var _ = Describe("BuildFailedItemDetails", func() {
	// AC: the store's aggregate-query list path shares the failed-detail builder
	// with the item-based paths, so all three stay in parity.

	It("sorts by checkpoint then error message", func() {
		details := model.BuildFailedItemDetails(map[string]map[string]model.CheckpointErrorDetail{
			"z-ckpt": {"b-err": {}, "a-err": {}},
			"a-ckpt": {"only": {}},
		})
		Expect(details).To(Equal([]model.FailedItemDetail{
			{CheckpointFilename: "a-ckpt", ErrorMessage: "only"},
			{CheckpointFilename: "z-ckpt", ErrorMessage: "a-err"},
			{CheckpointFilename: "z-ckpt", ErrorMessage: "b-err"},
		}))
	})

	It("emits 'unknown error' for a checkpoint with no recorded messages", func() {
		details := model.BuildFailedItemDetails(map[string]map[string]model.CheckpointErrorDetail{
			"ckpt": {},
		})
		Expect(details).To(Equal([]model.FailedItemDetail{
			{CheckpointFilename: "ckpt", ErrorMessage: "unknown error"},
		}))
	})

	It("returns an empty non-nil slice for no failures", func() {
		details := model.BuildFailedItemDetails(nil)
		Expect(details).ToNot(BeNil())
		Expect(details).To(BeEmpty())
	})

	It("matches what AggregateItemProgress produces for the same failures", func() {
		// Parity check between the two entry points: the store reconstructs the
		// same map shape from SQL that the item-based path builds in memory.
		items := []model.SampleJobItem{
			item("ckpt-a", model.SampleJobItemStatusFailed, "boom"),
			item("ckpt-b", model.SampleJobItemStatusSkipped, ""),
		}
		fromItems := model.AggregateItemProgress(items).Progress.FailedItemDetails
		fromMap := model.BuildFailedItemDetails(map[string]map[string]model.CheckpointErrorDetail{
			"ckpt-a": {"boom": {}},
			"ckpt-b": {},
		})
		Expect(fromMap).To(Equal(fromItems))
	})
})
