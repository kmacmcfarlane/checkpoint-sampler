package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("comfyui", func() {
	Description("ComfyUI integration service")

	Method("status", func() {
		Description("Check ComfyUI connection status")
		Result(ComfyUIStatusResult)
		HTTP(func() {
			GET("/api/comfyui/status")
			Response(StatusOK)
		})
	})

	Method("models", func() {
		Description("Get available models by type")
		Payload(func() {
			Attribute("type", String, "Model type (vae, clip, unet, sampler, scheduler)", func() {
				Enum("vae", "clip", "unet", "sampler", "scheduler")
			})
			Required("type")
		})
		Result(ComfyUIModelsResult)
		HTTP(func() {
			GET("/api/comfyui/models")
			Param("type")
			Response(StatusOK)
		})
	})
})

var ComfyUIStatusResult = Type("ComfyUIStatusResult", func() {
	Attribute("connected", Boolean, "Whether ComfyUI is connected", func() {
		Example(true)
	})
	Attribute("enabled", Boolean, "Whether ComfyUI integration is enabled", func() {
		Example(true)
	})
	Required("connected", "enabled")
})

var ComfyUIModelsResult = Type("ComfyUIModelsResult", func() {
	Attribute("models", ArrayOf(String), "List of available model names", func() {
		Example([]string{"model1.safetensors", "model2.safetensors"})
	})
	Required("models")
})
