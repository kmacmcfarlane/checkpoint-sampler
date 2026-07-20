package model

import "sort"

// CheckpointErrorDetail holds the structured error metadata recorded alongside a
// failed sample job item's error message.
type CheckpointErrorDetail struct {
	ExceptionType string
	NodeType      string
	Traceback     string
}

// JobProgressAggregate is the result of aggregating a job's items.
//
// Progress carries the full computed progress metrics. CompletedCheckpoints
// lists (in sorted order) the checkpoints whose items are all done with zero
// failures — callers that need to act per completed checkpoint (such as the
// executor's completeness verification) use this rather than recomputing.
type JobProgressAggregate struct {
	Progress             JobProgress
	CompletedCheckpoints []string
}

// AggregateItemProgress computes job progress metrics from a job's item rows.
//
// This is the single canonical implementation of checkpoint progress
// aggregation. It was previously duplicated across the service's GetProgress,
// the executor's progress broadcast, and the store's list path; the copies
// drifted and produced inconsistent results (B-162 class). All callers must go
// through this helper (or BuildFailedItemDetails for the aggregate-query path).
//
// Semantics:
//   - failed and skipped items both count as Failed.
//   - A checkpoint is "completed" when every item is done and none failed.
//   - CurrentCheckpoint is the first (in sorted filename order) checkpoint that
//     still has unfinished items.
//   - Iteration is sorted throughout so output is deterministic.
func AggregateItemProgress(items []SampleJobItem) JobProgressAggregate {
	type checkpointStats struct {
		total     int
		completed int
		failed    int
		// Unique error messages for this checkpoint with their structured details.
		errors map[string]CheckpointErrorDetail
	}

	var itemCounts ItemStatusCounts
	statsByCheckpoint := make(map[string]*checkpointStats)

	for _, item := range items {
		stats, ok := statsByCheckpoint[item.CheckpointFilename]
		if !ok {
			stats = &checkpointStats{errors: make(map[string]CheckpointErrorDetail)}
			statsByCheckpoint[item.CheckpointFilename] = stats
		}
		stats.total++
		switch item.Status {
		case SampleJobItemStatusCompleted:
			stats.completed++
			itemCounts.Completed++
		case SampleJobItemStatusFailed, SampleJobItemStatusSkipped:
			stats.failed++
			itemCounts.Failed++
			if item.ErrorMessage != "" {
				stats.errors[item.ErrorMessage] = CheckpointErrorDetail{
					ExceptionType: item.ExceptionType,
					NodeType:      item.NodeType,
					Traceback:     item.Traceback,
				}
			}
		case SampleJobItemStatusPending:
			itemCounts.Pending++
		}
	}

	// Sort checkpoint filenames for deterministic iteration order.
	checkpointNames := make([]string, 0, len(statsByCheckpoint))
	for checkpoint := range statsByCheckpoint {
		checkpointNames = append(checkpointNames, checkpoint)
	}
	sort.Strings(checkpointNames)

	checkpointsCompleted := 0
	var completedCheckpoints []string
	var currentCheckpoint string
	var currentCheckpointProgress, currentCheckpointTotal int

	// checkpoint -> errMsg -> detail, for the shared failed-detail builder. A
	// checkpoint with failures but no recorded messages maps to an empty inner map.
	failedByCheckpoint := make(map[string]map[string]CheckpointErrorDetail)

	for _, checkpoint := range checkpointNames {
		stats := statsByCheckpoint[checkpoint]
		allDone := stats.completed+stats.failed == stats.total
		if allDone && stats.failed == 0 {
			checkpointsCompleted++
			completedCheckpoints = append(completedCheckpoints, checkpoint)
		} else if currentCheckpoint == "" && !allDone {
			// First incomplete checkpoint becomes the "current" one.
			currentCheckpoint = checkpoint
			currentCheckpointProgress = stats.completed
			currentCheckpointTotal = stats.total
		}

		// A checkpoint is considered failed if ANY of its items failed.
		if stats.failed > 0 {
			failedByCheckpoint[checkpoint] = stats.errors
		}
	}

	return JobProgressAggregate{
		Progress: JobProgress{
			CheckpointsCompleted:      checkpointsCompleted,
			TotalCheckpoints:          len(statsByCheckpoint),
			CurrentCheckpoint:         currentCheckpoint,
			CurrentCheckpointProgress: currentCheckpointProgress,
			CurrentCheckpointTotal:    currentCheckpointTotal,
			ItemCounts:                itemCounts,
			FailedItemDetails:         BuildFailedItemDetails(failedByCheckpoint),
		},
		CompletedCheckpoints: completedCheckpoints,
	}
}

// BuildFailedItemDetails flattens a checkpoint -> errorMessage -> detail map into
// the deterministic, sorted FailedItemDetail slice used by every progress path.
//
// A checkpoint present in the map with an empty inner map means it had failed
// items but none carried an error message; it is still reported, with the
// message "unknown error". The result is never nil, so API responses serialize
// an empty array rather than null.
func BuildFailedItemDetails(failedByCheckpoint map[string]map[string]CheckpointErrorDetail) []FailedItemDetail {
	details := []FailedItemDetail{}

	checkpointNames := make([]string, 0, len(failedByCheckpoint))
	for checkpoint := range failedByCheckpoint {
		checkpointNames = append(checkpointNames, checkpoint)
	}
	sort.Strings(checkpointNames)

	for _, checkpoint := range checkpointNames {
		byMsg := failedByCheckpoint[checkpoint]
		if len(byMsg) == 0 {
			details = append(details, FailedItemDetail{
				CheckpointFilename: checkpoint,
				ErrorMessage:       "unknown error",
			})
			continue
		}

		// Sort error messages so repeated calls emit a stable order.
		msgs := make([]string, 0, len(byMsg))
		for msg := range byMsg {
			msgs = append(msgs, msg)
		}
		sort.Strings(msgs)

		for _, msg := range msgs {
			detail := byMsg[msg]
			details = append(details, FailedItemDetail{
				CheckpointFilename: checkpoint,
				ErrorMessage:       msg,
				ExceptionType:      detail.ExceptionType,
				NodeType:           detail.NodeType,
				Traceback:          detail.Traceback,
			})
		}
	}

	return details
}
