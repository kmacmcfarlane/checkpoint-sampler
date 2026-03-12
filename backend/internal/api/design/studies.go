package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("studies", func() {
	Description("Study management service")

	Method("list", func() {
		Description("List all saved studies")
		Result(ArrayOf(StudyResponse))
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/studies")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("create", func() {
		Description("Create a new study")
		Payload(CreateStudyPayload)
		Result(StudyResponse)
		Error("invalid_payload", ErrorResult, "Invalid study data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			POST("/api/studies")
			Response(StatusCreated)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("update", func() {
		Description("Update an existing study")
		Payload(UpdateStudyPayload)
		Result(StudyResponse)
		Error("not_found", ErrorResult, "Study not found")
		Error("invalid_payload", ErrorResult, "Invalid study data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			PUT("/api/studies/{id}")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("fork", func() {
		Description("Fork an existing study: create a new study from an existing one with modified settings")
		Payload(ForkStudyPayload)
		Result(StudyResponse)
		Error("not_found", ErrorResult, "Source study not found")
		Error("invalid_payload", ErrorResult, "Invalid study data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			POST("/api/studies/{source_id}/fork")
			Response(StatusCreated)
			Response("not_found", StatusNotFound)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("has_samples", func() {
		Description("Check whether a study has generated samples on disk")
		Payload(func() {
			Attribute("id", String, "Study ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Result(HasSamplesResponse)
		Error("not_found", ErrorResult, "Study not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/studies/{id}/has-samples")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("delete", func() {
		Description("Delete a study. When delete_data is true, also removes the study's sample output directory from disk.")
		Payload(func() {
			Attribute("id", String, "Study ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Attribute("delete_data", Boolean, "When true, also deletes the study's sample output directory from disk", func() {
				Default(false)
			})
			Required("id")
		})
		Error("not_found", ErrorResult, "Study not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			DELETE("/api/studies/{id}")
			Param("delete_data")
			Response(StatusNoContent)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("availability", func() {
		Description("Get per-study sample availability for a training run. For each study, returns whether it has samples matching the training run's checkpoints.")
		Payload(func() {
			Attribute("training_run_id", Int, "Training run index (zero-based) to check availability against", func() {
				Minimum(0)
			})
			Required("training_run_id")
		})
		Result(ArrayOf(StudyAvailabilityResponse))
		Error("not_found", ErrorResult, "Training run not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/studies/availability")
			Param("training_run_id")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})
})

var StudyResponse = Type("StudyResponse", func() {
	Description("A saved study")
	Attribute("id", String, "Study ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "Study display name", func() {
		Example("My Study")
	})
	Attribute("prompt_prefix", String, "Text prepended to each prompt at generation time", func() {
		Example("photo of a person, ")
	})
	Attribute("prompts", ArrayOf(NamedPrompt), "List of named prompts")
	Attribute("negative_prompt", String, "Negative prompt text", func() {
		Example("low quality, blurry")
	})
	Attribute("steps", ArrayOf(Int), "Step counts to iterate", func() {
		Example([]int{1, 4, 8})
	})
	Attribute("cfgs", ArrayOf(Float64), "CFG scale values to iterate", func() {
		Example([]float64{1.0, 3.0, 7.0})
	})
	Attribute("sampler_scheduler_pairs", ArrayOf(SamplerSchedulerPair), "Sampler/scheduler pair combinations")
	Attribute("seeds", ArrayOf(Int64), "Seed values to iterate", func() {
		Example([]int64{420, 421, 422})
	})
	Attribute("width", Int, "Image width in pixels", func() {
		Example(1344)
	})
	Attribute("height", Int, "Image height in pixels", func() {
		Example(1344)
	})
	Attribute("workflow_template", String, "ComfyUI workflow template filename (optional)", func() {
		Example("qwen-image.json")
		Default("")
	})
	Attribute("vae", String, "ComfyUI VAE model path (optional)", func() {
		Example("ae.safetensors")
		Default("")
	})
	Attribute("text_encoder", String, "ComfyUI CLIP/text encoder model path (optional)", func() {
		Example("clip_l.safetensors")
		Default("")
	})
	Attribute("shift", Float64, "AuraFlow shift value (optional, nullable)")
	Attribute("images_per_checkpoint", Int, "Computed: total images per checkpoint", func() {
		Example(54)
	})
	Attribute("created_at", String, "Creation timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Attribute("updated_at", String, "Last update timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Required("id", "name", "prompt_prefix", "prompts", "negative_prompt", "steps", "cfgs", "sampler_scheduler_pairs", "seeds", "width", "height", "workflow_template", "vae", "text_encoder", "images_per_checkpoint", "created_at", "updated_at")
})

var CreateStudyPayload = Type("CreateStudyPayload", func() {
	Description("Payload for creating a new study")
	Attribute("name", String, "Study display name", func() {
		Example("My Study")
		MinLength(1)
	})
	Attribute("prompt_prefix", String, "Text prepended to each prompt at generation time", func() {
		Example("photo of a person, ")
		Default("")
	})
	Attribute("prompts", ArrayOf(NamedPrompt), "List of named prompts", func() {
		MinLength(1)
	})
	Attribute("negative_prompt", String, "Negative prompt text", func() {
		Example("low quality, blurry")
		Default("")
	})
	Attribute("steps", ArrayOf(Int), "Step counts to iterate", func() {
		Example([]int{1, 4, 8})
		MinLength(1)
	})
	Attribute("cfgs", ArrayOf(Float64), "CFG scale values to iterate", func() {
		Example([]float64{1.0, 3.0, 7.0})
		MinLength(1)
	})
	Attribute("sampler_scheduler_pairs", ArrayOf(SamplerSchedulerPair), "Sampler/scheduler pair combinations", func() {
		MinLength(1)
	})
	Attribute("seeds", ArrayOf(Int64), "Seed values to iterate", func() {
		Example([]int64{420, 421, 422})
		MinLength(1)
	})
	Attribute("width", Int, "Image width in pixels", func() {
		Example(1344)
		Minimum(1)
	})
	Attribute("height", Int, "Image height in pixels", func() {
		Example(1344)
		Minimum(1)
	})
	Attribute("workflow_template", String, "ComfyUI workflow template filename (optional)", func() {
		Example("qwen-image.json")
		Default("")
	})
	Attribute("vae", String, "ComfyUI VAE model path (optional)", func() {
		Example("ae.safetensors")
		Default("")
	})
	Attribute("text_encoder", String, "ComfyUI CLIP/text encoder model path (optional)", func() {
		Example("clip_l.safetensors")
		Default("")
	})
	Attribute("shift", Float64, "AuraFlow shift value (optional, nullable)")
	Required("name", "prompt_prefix", "prompts", "negative_prompt", "steps", "cfgs", "sampler_scheduler_pairs", "seeds", "width", "height")
})

var UpdateStudyPayload = Type("UpdateStudyPayload", func() {
	Description("Payload for updating a study")
	Attribute("id", String, "Study ID", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "Study display name", func() {
		Example("My Study")
		MinLength(1)
	})
	Attribute("prompt_prefix", String, "Text prepended to each prompt at generation time", func() {
		Example("photo of a person, ")
		Default("")
	})
	Attribute("prompts", ArrayOf(NamedPrompt), "List of named prompts", func() {
		MinLength(1)
	})
	Attribute("negative_prompt", String, "Negative prompt text", func() {
		Example("low quality, blurry")
		Default("")
	})
	Attribute("steps", ArrayOf(Int), "Step counts to iterate", func() {
		Example([]int{1, 4, 8})
		MinLength(1)
	})
	Attribute("cfgs", ArrayOf(Float64), "CFG scale values to iterate", func() {
		Example([]float64{1.0, 3.0, 7.0})
		MinLength(1)
	})
	Attribute("sampler_scheduler_pairs", ArrayOf(SamplerSchedulerPair), "Sampler/scheduler pair combinations", func() {
		MinLength(1)
	})
	Attribute("seeds", ArrayOf(Int64), "Seed values to iterate", func() {
		Example([]int64{420, 421, 422})
		MinLength(1)
	})
	Attribute("width", Int, "Image width in pixels", func() {
		Example(1344)
		Minimum(1)
	})
	Attribute("height", Int, "Image height in pixels", func() {
		Example(1344)
		Minimum(1)
	})
	Attribute("workflow_template", String, "ComfyUI workflow template filename (optional)", func() {
		Example("qwen-image.json")
		Default("")
	})
	Attribute("vae", String, "ComfyUI VAE model path (optional)", func() {
		Example("ae.safetensors")
		Default("")
	})
	Attribute("text_encoder", String, "ComfyUI CLIP/text encoder model path (optional)", func() {
		Example("clip_l.safetensors")
		Default("")
	})
	Attribute("shift", Float64, "AuraFlow shift value (optional, nullable)")
	Required("id", "name", "prompt_prefix", "prompts", "negative_prompt", "steps", "cfgs", "sampler_scheduler_pairs", "seeds", "width", "height")
})

var ForkStudyPayload = Type("ForkStudyPayload", func() {
	Description("Payload for forking a study (creating a new study from an existing one)")
	Attribute("source_id", String, "Source study ID to fork from", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "New study display name", func() {
		Example("My Study - copy")
		MinLength(1)
	})
	Attribute("prompt_prefix", String, "Text prepended to each prompt at generation time", func() {
		Example("photo of a person, ")
		Default("")
	})
	Attribute("prompts", ArrayOf(NamedPrompt), "List of named prompts", func() {
		MinLength(1)
	})
	Attribute("negative_prompt", String, "Negative prompt text", func() {
		Example("low quality, blurry")
		Default("")
	})
	Attribute("steps", ArrayOf(Int), "Step counts to iterate", func() {
		Example([]int{1, 4, 8})
		MinLength(1)
	})
	Attribute("cfgs", ArrayOf(Float64), "CFG scale values to iterate", func() {
		Example([]float64{1.0, 3.0, 7.0})
		MinLength(1)
	})
	Attribute("sampler_scheduler_pairs", ArrayOf(SamplerSchedulerPair), "Sampler/scheduler pair combinations", func() {
		MinLength(1)
	})
	Attribute("seeds", ArrayOf(Int64), "Seed values to iterate", func() {
		Example([]int64{420, 421, 422})
		MinLength(1)
	})
	Attribute("width", Int, "Image width in pixels", func() {
		Example(1344)
		Minimum(1)
	})
	Attribute("height", Int, "Image height in pixels", func() {
		Example(1344)
		Minimum(1)
	})
	Attribute("workflow_template", String, "ComfyUI workflow template filename (optional)", func() {
		Example("qwen-image.json")
		Default("")
	})
	Attribute("vae", String, "ComfyUI VAE model path (optional)", func() {
		Example("ae.safetensors")
		Default("")
	})
	Attribute("text_encoder", String, "ComfyUI CLIP/text encoder model path (optional)", func() {
		Example("clip_l.safetensors")
		Default("")
	})
	Attribute("shift", Float64, "AuraFlow shift value (optional, nullable)")
	Required("source_id", "name", "prompt_prefix", "prompts", "negative_prompt", "steps", "cfgs", "sampler_scheduler_pairs", "seeds", "width", "height")
})

var NamedPrompt = Type("NamedPrompt", func() {
	Description("A prompt with a name and text")
	Attribute("name", String, "Prompt name (used in filename)", func() {
		Example("forest_portals")
		MinLength(1)
	})
	Attribute("text", String, "Prompt text", func() {
		Example("a mystical forest with glowing portals")
		MinLength(1)
	})
	Required("name", "text")
})

var SamplerSchedulerPair = Type("SamplerSchedulerPair", func() {
	Description("A specific sampler and scheduler combination")
	Attribute("sampler", String, "Sampler name", func() {
		Example("euler")
		MinLength(1)
	})
	Attribute("scheduler", String, "Scheduler name", func() {
		Example("normal")
		MinLength(1)
	})
	Required("sampler", "scheduler")
})

var HasSamplesResponse = Type("HasSamplesResponse", func() {
	Description("Response for checking if a study has generated samples")
	Attribute("has_samples", Boolean, "Whether the study has generated samples on disk", func() {
		Example(true)
	})
	Required("has_samples")
})

var StudyAvailabilityResponse = Type("StudyAvailabilityResponse", func() {
	Description("Per-study sample availability for a training run")
	Attribute("study_id", String, "Study ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("study_name", String, "Study display name", func() {
		Example("My Study")
	})
	Attribute("has_samples", Boolean, "Whether this study has samples for the target training run", func() {
		Example(true)
	})
	Attribute("sample_status", String, "Sample completeness status for the target training run: 'none' = no samples, 'partial' = some checkpoints have samples, 'complete' = all checkpoints have samples", func() {
		Example("complete")
		Enum("none", "partial", "complete")
	})
	Attribute("checkpoints_with_samples", Int, "Number of training run checkpoints that have a matching sample directory for this study", func() {
		Example(3)
	})
	Attribute("total_checkpoints", Int, "Total number of checkpoints in the training run", func() {
		Example(5)
	})
	Required("study_id", "study_name", "has_samples", "sample_status", "checkpoints_with_samples", "total_checkpoints")
})
