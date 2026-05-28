package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("base_models", func() {
	Description("Base model discovery service for listing available base models from the configured directory")

	Method("list", func() {
		Description("List available base model .safetensors files from base_model_dir (or checkpoint_dirs[0] fallback)")
		Result(BaseModelsResult)
		Error("scan_failed", ErrorResult, "Failed to scan base model directory")
		HTTP(func() {
			GET("/api/base-models")
			Response(StatusOK)
			Response("scan_failed", StatusInternalServerError)
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
