package service

import (
	"encoding/base64"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// TrainingRunID derives a stable, opaque identifier for a training run.
//
// S-155: training-run resource IDs were previously positional indices assigned
// at discovery time. A rescan could reorder discovery, so a held ID could later
// resolve to a different run. The ID is now derived from the run's stable
// identity — its Name, which is the full relative path (study output dir prefix
// plus base name for viewer runs, or the grouped base name for checkpoint runs)
// and is unique within a single discovery source. The result is URL-safe base64
// of the name so it survives rescans and is safe to embed in URL path segments.
func TrainingRunID(tr model.TrainingRun) string {
	return base64.RawURLEncoding.EncodeToString([]byte(tr.Name))
}

// FindTrainingRunByID returns the training run whose stable ID matches id.
// The boolean is false when no run matches. Resolution is independent of the
// discovery order, so a held ID addresses the same run across rescans.
func FindTrainingRunByID(runs []model.TrainingRun, id string) (model.TrainingRun, bool) {
	for _, tr := range runs {
		if TrainingRunID(tr) == id {
			return tr, true
		}
	}
	return model.TrainingRun{}, false
}
