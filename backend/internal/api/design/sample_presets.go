package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("sample_presets", func() {
	Description("Sample setting preset management service")

	Method("list", func() {
		Description("List all saved sample presets")
		Result(ArrayOf(SamplePresetResponse))
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/sample-presets")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("create", func() {
		Description("Create a new sample preset")
		Payload(CreateSamplePresetPayload)
		Result(SamplePresetResponse)
		Error("invalid_payload", ErrorResult, "Invalid sample preset data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			POST("/api/sample-presets")
			Response(StatusCreated)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("update", func() {
		Description("Update an existing sample preset")
		Payload(UpdateSamplePresetPayload)
		Result(SamplePresetResponse)
		Error("not_found", ErrorResult, "Sample preset not found")
		Error("invalid_payload", ErrorResult, "Invalid sample preset data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			PUT("/api/sample-presets/{id}")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("delete", func() {
		Description("Delete a sample preset")
		Payload(func() {
			Attribute("id", String, "Sample preset ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Error("not_found", ErrorResult, "Sample preset not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			DELETE("/api/sample-presets/{id}")
			Response(StatusNoContent)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})
})

var SamplePresetResponse = Type("SamplePresetResponse", func() {
	Description("A saved sample setting preset")
	Attribute("id", String, "Preset ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "Preset display name", func() {
		Example("My Sample Config")
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
	Attribute("samplers", ArrayOf(String), "Sampler names to iterate", func() {
		Example([]string{"euler", "res_multistep"})
	})
	Attribute("schedulers", ArrayOf(String), "Scheduler names to iterate", func() {
		Example([]string{"simple", "normal"})
	})
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
	Required("id", "name", "prompts", "negative_prompt", "steps", "cfgs", "samplers", "schedulers", "seeds", "width", "height", "images_per_checkpoint", "created_at", "updated_at")
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

var CreateSamplePresetPayload = Type("CreateSamplePresetPayload", func() {
	Description("Payload for creating a new sample preset")
	Attribute("name", String, "Preset display name", func() {
		Example("My Sample Config")
		MinLength(1)
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
	Attribute("samplers", ArrayOf(String), "Sampler names to iterate", func() {
		Example([]string{"euler", "res_multistep"})
		MinLength(1)
	})
	Attribute("schedulers", ArrayOf(String), "Scheduler names to iterate", func() {
		Example([]string{"simple", "normal"})
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
	Required("name", "prompts", "negative_prompt", "steps", "cfgs", "samplers", "schedulers", "seeds", "width", "height")
})

var UpdateSamplePresetPayload = Type("UpdateSamplePresetPayload", func() {
	Description("Payload for updating a sample preset")
	Attribute("id", String, "Sample preset ID", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "Preset display name", func() {
		Example("My Sample Config")
		MinLength(1)
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
	Attribute("samplers", ArrayOf(String), "Sampler names to iterate", func() {
		Example([]string{"euler", "res_multistep"})
		MinLength(1)
	})
	Attribute("schedulers", ArrayOf(String), "Scheduler names to iterate", func() {
		Example([]string{"simple", "normal"})
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
	Required("id", "name", "prompts", "negative_prompt", "steps", "cfgs", "samplers", "schedulers", "seeds", "width", "height")
})
