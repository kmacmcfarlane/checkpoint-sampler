package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("base_models", func() {
	Description("Base model discovery service for listing available base models from the configured directory")

	Method("list", func() {
		Description("List available base model .safetensors files from base_model_dir (or checkpoint_dirs[0] fallback)")
		Result(BaseModelsResult)
		// internal_error: canonical 500 (see errors.go for the shared vocabulary).
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/base-models")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})
})

var BaseModelsResult = Type("BaseModelsResult", func() {
	Description("List of available base model filenames")
	Attribute("models", ArrayOf(String), "Base model .safetensors filenames (relative paths from the base model directory)", func() {
		Example([]string{"flux1-dev.safetensors", "sdxl/base-v1.0.safetensors"})
	})
	Required("models")
})
