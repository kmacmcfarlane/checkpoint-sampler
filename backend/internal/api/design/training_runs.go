package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("training_runs", func() {
	Description("Training run discovery and scanning service")

	Method("list", func() {
		Description("List auto-discovered training runs")
		Payload(func() {
			Attribute("has_samples", Boolean, "Filter to only training runs with at least one checkpoint that has samples", func() {
				Default(false)
			})
			Attribute("source", String, "Discovery source: 'samples' discovers from sample output directories (viewer), 'checkpoints' discovers from checkpoint files (job creation)", func() {
				Default("samples")
				Enum("samples", "checkpoints")
			})
		})
		Result(ArrayOf(TrainingRunResponse))
		Error("discovery_failed", ErrorResult, "Discovery operation failed")
		HTTP(func() {
			GET("/api/training-runs")
			Param("has_samples")
			Param("source")
			Response(StatusOK)
			Response("discovery_failed", StatusInternalServerError)
		})
	})

	Method("validate", func() {
		Description("Validate sample set completeness for a training run by comparing PNG file counts per checkpoint. When study_id is provided, uses the study's expected images-per-checkpoint for comparison instead of the max-file-count heuristic.")
		Payload(func() {
			Attribute("id", Int, "Training run index (zero-based)", func() {
				Minimum(0)
			})
			Attribute("study_id", String, "Optional study ID for study-aware validation (uses study images_per_checkpoint as expected count)")
			Required("id")
		})
		Result(ValidationResultResponse)
		Error("not_found", ErrorResult, "Training run or study not found")
		Error("validation_failed", ErrorResult, "Validation operation failed")
		HTTP(func() {
			POST("/api/training-runs/{id}/validate")
			Param("study_id")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("validation_failed", StatusInternalServerError)
		})
	})

	Method("scan", func() {
		Description("Scan a training run's sample directories and return image metadata with discovered dimensions")
		Payload(func() {
			Attribute("id", Int, "Training run index (zero-based)", func() {
				Minimum(0)
			})
			Attribute("study_name", String, "Study name to scope the scan to a study subdirectory", func() {
				Default("")
			})
			Required("id")
		})
		Result(ScanResultResponse)
		Error("not_found", ErrorResult, "Training run not found")
		Error("scan_failed", ErrorResult, "Scan operation failed")
		HTTP(func() {
			GET("/api/training-runs/{id}/scan")
			Param("study_name")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("scan_failed", StatusInternalServerError)
		})
	})
})

var TrainingRunResponse = Type("TrainingRunResponse", func() {
	Description("An auto-discovered training run")
	Attribute("id", Int, "Training run index (zero-based)", func() {
		Example(0)
	})
	Attribute("name", String, "Training run base name (after stripping checkpoint suffixes)", func() {
		Example("qwen/psai4rt-v0.3.0-no-reg")
	})
	Attribute("checkpoint_count", Int, "Number of checkpoint files in this training run", func() {
		Example(3)
	})
	Attribute("has_samples", Boolean, "Whether at least one checkpoint has a matching sample directory", func() {
		Example(true)
	})
	Attribute("checkpoints", ArrayOf(CheckpointResponse), "Checkpoints in this training run (sorted by step number)")
	Required("id", "name", "checkpoint_count", "has_samples", "checkpoints")
})

var CheckpointResponse = Type("CheckpointResponse", func() {
	Description("A checkpoint file within a training run")
	Attribute("filename", String, "Checkpoint filename", func() {
		Example("psai4rt-v0.3.0-no-reg-step00004500.safetensors")
	})
	Attribute("step_number", Int, "Extracted step/epoch number (-1 if not parseable)", func() {
		Example(4500)
	})
	Attribute("has_samples", Boolean, "Whether a matching sample directory exists", func() {
		Example(true)
	})
	Required("filename", "step_number", "has_samples")
})

var ScanResultResponse = Type("ScanResultResponse", func() {
	Description("Result of scanning a training run's sample directories")
	Attribute("images", ArrayOf(ImageResponse), "Discovered images with dimension values")
	Attribute("dimensions", ArrayOf(DimensionResponse), "Discovered dimensions with unique values")
	Required("images", "dimensions")
})

var ImageResponse = Type("ImageResponse", func() {
	Description("A discovered image with its dimension values")
	Attribute("relative_path", String, "Image path relative to sample directory", func() {
		Example("psai4rt-v0.3.0-no-reg-step00004500.safetensors/index=0&prompt_name=forest&seed=420&cfg=1&_00001_.png")
	})
	Attribute("dimensions", MapOf(String, String), "Dimension key-value pairs for this image", func() {
		Example(map[string]string{"checkpoint": "4500", "prompt_name": "forest", "seed": "420"})
	})
	Required("relative_path", "dimensions")
})

var DimensionResponse = Type("DimensionResponse", func() {
	Description("A discovered dimension with its unique values")
	Attribute("name", String, "Dimension name", func() {
		Example("checkpoint")
	})
	Attribute("type", String, "Dimension type (int or string)", func() {
		Example("int")
		Enum("int", "string")
	})
	Attribute("values", ArrayOf(String), "Sorted unique values for this dimension", func() {
		Example([]string{"4500", "4750", "5000"})
	})
	Required("name", "type", "values")
})

var ValidationResultResponse = Type("ValidationResultResponse", func() {
	Description("Result of validating sample set completeness for a training run")
	Attribute("checkpoints", ArrayOf(CheckpointCompletenessResponse), "Per-checkpoint completeness counts")
	Attribute("expected_per_checkpoint", Int, "Study-derived expected images per checkpoint (0 when no study context)", func() {
		Example(54)
	})
	Attribute("total_expected", Int, "Total expected images across all checkpoints", func() {
		Example(270)
	})
	Attribute("total_verified", Int, "Total verified images across all checkpoints", func() {
		Example(216)
	})
	Attribute("total_actual", Int, "Total sample images found on disk across all checkpoints", func() {
		Example(240)
	})
	Attribute("total_missing", Int, "Total missing sample images across all checkpoints (total_expected - total_actual)", func() {
		Example(30)
	})
	Required("checkpoints", "expected_per_checkpoint", "total_expected", "total_verified", "total_actual", "total_missing")
})

var CheckpointCompletenessResponse = Type("CheckpointCompletenessResponse", func() {
	Description("Completeness info for a single checkpoint's sample directory")
	Attribute("checkpoint", String, "Checkpoint filename", func() {
		Example("model-step00001000.safetensors")
	})
	Attribute("expected", Int, "Expected number of sample images (max count across all checkpoints)", func() {
		Example(54)
	})
	Attribute("verified", Int, "Number of sample images found on disk", func() {
		Example(54)
	})
	Attribute("missing", Int, "Number of missing sample images (expected - verified)", func() {
		Example(0)
	})
	Required("checkpoint", "expected", "verified", "missing")
})
