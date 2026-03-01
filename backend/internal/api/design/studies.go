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

	Method("delete", func() {
		Description("Delete a study")
		Payload(func() {
			Attribute("id", String, "Study ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Error("not_found", ErrorResult, "Study not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			DELETE("/api/studies/{id}")
			Response(StatusNoContent)
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
	Attribute("images_per_checkpoint", Int, "Computed: total images per checkpoint", func() {
		Example(54)
	})
	Attribute("created_at", String, "Creation timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Attribute("updated_at", String, "Last update timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Required("id", "name", "prompt_prefix", "prompts", "negative_prompt", "steps", "cfgs", "sampler_scheduler_pairs", "seeds", "width", "height", "images_per_checkpoint", "created_at", "updated_at")
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
	Required("id", "name", "prompt_prefix", "prompts", "negative_prompt", "steps", "cfgs", "sampler_scheduler_pairs", "seeds", "width", "height")
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
