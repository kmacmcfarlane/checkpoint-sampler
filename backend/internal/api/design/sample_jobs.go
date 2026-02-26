package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("sample_jobs", func() {
	Description("Sample job orchestration service")

	Method("list", func() {
		Description("List all sample jobs (newest first)")
		Result(ArrayOf(SampleJobResponse))
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/sample-jobs")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("show", func() {
		Description("Get a sample job by ID with progress metrics")
		Payload(func() {
			Attribute("id", String, "Sample job ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Result(SampleJobDetailResponse)
		Error("not_found", ErrorResult, "Sample job not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/sample-jobs/{id}")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("create", func() {
		Description("Create and start a new sample job")
		Payload(CreateSampleJobPayload)
		Result(SampleJobResponse)
		Error("not_found", ErrorResult, "Training run or sample preset not found")
		Error("invalid_payload", ErrorResult, "Invalid sample job data")
		HTTP(func() {
			POST("/api/sample-jobs")
			Response(StatusCreated)
			Response("not_found", StatusNotFound)
			Response("invalid_payload", StatusBadRequest)
		})
	})

	Method("start", func() {
		Description("Start a pending sample job")
		Payload(func() {
			Attribute("id", String, "Sample job ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Result(SampleJobResponse)
		Error("not_found", ErrorResult, "Sample job not found")
		Error("invalid_state", ErrorResult, "Cannot start job in current state")
		Error("service_unavailable", ErrorResult, "ComfyUI service unavailable")
		HTTP(func() {
			POST("/api/sample-jobs/{id}/start")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_state", StatusBadRequest)
			Response("service_unavailable", StatusServiceUnavailable)
		})
	})

	Method("stop", func() {
		Description("Stop a running sample job (pauses after current item)")
		Payload(func() {
			Attribute("id", String, "Sample job ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Result(SampleJobResponse)
		Error("not_found", ErrorResult, "Sample job not found")
		Error("invalid_state", ErrorResult, "Cannot stop job in current state")
		HTTP(func() {
			POST("/api/sample-jobs/{id}/stop")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_state", StatusBadRequest)
		})
	})

	Method("resume", func() {
		Description("Resume a paused sample job")
		Payload(func() {
			Attribute("id", String, "Sample job ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Result(SampleJobResponse)
		Error("not_found", ErrorResult, "Sample job not found")
		Error("invalid_state", ErrorResult, "Cannot resume job in current state")
		Error("service_unavailable", ErrorResult, "ComfyUI service unavailable")
		HTTP(func() {
			POST("/api/sample-jobs/{id}/resume")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_state", StatusBadRequest)
			Response("service_unavailable", StatusServiceUnavailable)
		})
	})

	Method("delete", func() {
		Description("Delete a sample job and all its items")
		Payload(func() {
			Attribute("id", String, "Sample job ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Error("not_found", ErrorResult, "Sample job not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			DELETE("/api/sample-jobs/{id}")
			Response(StatusNoContent)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})
})

var SampleJobResponse = Type("SampleJobResponse", func() {
	Description("A sample job")
	Attribute("id", String, "Job ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("training_run_name", String, "Training run identifier", func() {
		Example("qwen/psai4rt-v0.3.0-no-reg")
	})
	Attribute("sample_preset_id", String, "Sample preset ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("workflow_name", String, "Workflow template filename", func() {
		Example("qwen-image.json")
	})
	Attribute("vae", String, "Selected VAE (ComfyUI path)", func() {
		Example("ae.safetensors")
	})
	Attribute("clip", String, "Selected CLIP (ComfyUI path)", func() {
		Example("clip_l.safetensors")
	})
	Attribute("shift", Float64, "AuraFlow shift value (nullable)")
	Attribute("status", String, "Job status: pending, running, paused, completed, failed", func() {
		Example("running")
		Enum("pending", "running", "paused", "completed", "failed")
	})
	Attribute("total_items", Int, "Total work items", func() {
		Example(540)
	})
	Attribute("completed_items", Int, "Completed work items", func() {
		Example(120)
	})
	Attribute("error_message", String, "Error details if failed")
	Attribute("created_at", String, "Creation timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Attribute("updated_at", String, "Last update timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Required("id", "training_run_name", "sample_preset_id", "workflow_name", "status", "total_items", "completed_items", "created_at", "updated_at")
})

var SampleJobDetailResponse = Type("SampleJobDetailResponse", func() {
	Description("A sample job with progress metrics")
	Attribute("job", SampleJobResponse, "Job metadata")
	Attribute("progress", JobProgressResponse, "Progress metrics")
	Required("job", "progress")
})

var JobProgressResponse = Type("JobProgressResponse", func() {
	Description("Job progress metrics")
	Attribute("checkpoints_completed", Int, "Fully completed checkpoints", func() {
		Example(2)
	})
	Attribute("total_checkpoints", Int, "Total checkpoints in job", func() {
		Example(5)
	})
	Attribute("current_checkpoint", String, "Filename of checkpoint currently being processed", func() {
		Example("psai4rt-v0.3.0-no-reg-step00004500.safetensors")
	})
	Attribute("current_checkpoint_progress", Int, "Completed items in current checkpoint", func() {
		Example(30)
	})
	Attribute("current_checkpoint_total", Int, "Total items in current checkpoint", func() {
		Example(108)
	})
	Attribute("estimated_completion_time", String, "Estimated completion timestamp (RFC3339, nullable)")
	Required("checkpoints_completed", "total_checkpoints")
})

var CreateSampleJobPayload = Type("CreateSampleJobPayload", func() {
	Description("Payload for creating a new sample job")
	Attribute("training_run_name", String, "Training run identifier", func() {
		Example("qwen/psai4rt-v0.3.0-no-reg")
		MinLength(1)
	})
	Attribute("sample_preset_id", String, "Sample preset ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("workflow_name", String, "Workflow template filename", func() {
		Example("qwen-image.json")
		MinLength(1)
	})
	Attribute("vae", String, "Selected VAE (ComfyUI path)", func() {
		Example("ae.safetensors")
		Default("")
	})
	Attribute("clip", String, "Selected CLIP (ComfyUI path)", func() {
		Example("clip_l.safetensors")
		Default("")
	})
	Attribute("shift", Float64, "AuraFlow shift value (nullable, for workflows with shift role)")
	Attribute("checkpoint_filenames", ArrayOf(String), "Optional list of checkpoint filenames to include; when omitted all checkpoints are included", func() {
		Example([]string{"psai4rt-v0.3.0-no-reg-step00004500.safetensors"})
	})
	Attribute("clear_existing", Boolean, "When true, delete existing sample directories for selected checkpoints before creating job items", func() {
		Default(false)
	})
	Required("training_run_name", "sample_preset_id", "workflow_name")
})
