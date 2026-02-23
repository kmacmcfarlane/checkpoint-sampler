package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("presets", func() {
	Description("Preset management service for dimension mapping configurations")

	Method("list", func() {
		Description("List all saved presets")
		Result(ArrayOf(PresetResponse))
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/presets")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("create", func() {
		Description("Create a new preset")
		Payload(CreatePresetPayload)
		Result(PresetResponse)
		Error("invalid_payload", ErrorResult, "Invalid preset data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			POST("/api/presets")
			Response(StatusCreated)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("update", func() {
		Description("Update an existing preset")
		Payload(UpdatePresetPayload)
		Result(PresetResponse)
		Error("not_found", ErrorResult, "Preset not found")
		Error("invalid_payload", ErrorResult, "Invalid preset data")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			PUT("/api/presets/{id}")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_payload", StatusBadRequest)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("delete", func() {
		Description("Delete a preset")
		Payload(func() {
			Attribute("id", String, "Preset ID", func() {
				Example("550e8400-e29b-41d4-a716-446655440000")
			})
			Required("id")
		})
		Error("not_found", ErrorResult, "Preset not found")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			DELETE("/api/presets/{id}")
			Response(StatusNoContent)
			Response("not_found", StatusNotFound)
			Response("internal_error", StatusInternalServerError)
		})
	})
})

var PresetResponse = Type("PresetResponse", func() {
	Description("A saved dimension mapping preset")
	Attribute("id", String, "Preset ID (UUID)", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "Preset display name", func() {
		Example("My Config")
	})
	Attribute("mapping", PresetMappingResponse, "Dimension-to-role assignments")
	Attribute("created_at", String, "Creation timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Attribute("updated_at", String, "Last update timestamp (RFC3339)", func() {
		Example("2025-01-01T00:00:00Z")
	})
	Required("id", "name", "mapping", "created_at", "updated_at")
})

var PresetMappingResponse = Type("PresetMappingResponse", func() {
	Description("Dimension-to-role assignments for a preset")
	Attribute("x", String, "Dimension assigned to X axis", func() {
		Example("cfg")
	})
	Attribute("y", String, "Dimension assigned to Y axis", func() {
		Example("prompt_name")
	})
	Attribute("slider", String, "Dimension assigned to slider", func() {
		Example("checkpoint")
	})
	Attribute("combos", ArrayOf(String), "Dimensions assigned to combo filters", func() {
		Example([]string{"seed", "index"})
	})
	Required("combos")
})

var CreatePresetPayload = Type("CreatePresetPayload", func() {
	Description("Payload for creating a new preset")
	Attribute("name", String, "Preset display name", func() {
		Example("My Config")
		MinLength(1)
	})
	Attribute("mapping", PresetMappingPayload, "Dimension-to-role assignments")
	Required("name", "mapping")
})

var UpdatePresetPayload = Type("UpdatePresetPayload", func() {
	Description("Payload for updating a preset")
	Attribute("id", String, "Preset ID", func() {
		Example("550e8400-e29b-41d4-a716-446655440000")
	})
	Attribute("name", String, "Preset display name", func() {
		Example("My Config")
		MinLength(1)
	})
	Attribute("mapping", PresetMappingPayload, "Dimension-to-role assignments")
	Required("id", "name", "mapping")
})

var PresetMappingPayload = Type("PresetMappingPayload", func() {
	Description("Dimension-to-role assignments input")
	Attribute("x", String, "Dimension assigned to X axis", func() {
		Example("cfg")
	})
	Attribute("y", String, "Dimension assigned to Y axis", func() {
		Example("prompt_name")
	})
	Attribute("slider", String, "Dimension assigned to slider", func() {
		Example("checkpoint")
	})
	Attribute("combos", ArrayOf(String), "Dimensions assigned to combo filters", func() {
		Example([]string{"seed", "index"})
	})
	Required("combos")
})
