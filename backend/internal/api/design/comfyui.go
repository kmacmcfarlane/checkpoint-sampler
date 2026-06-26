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
		// ComfyUI outages previously surfaced as unmapped 500s (R-016). Declare the
		// canonical failure set so they map to stable, documented status codes:
		//   service_unavailable (503) — ComfyUI connection is down / not reachable.
		//   internal_error (500)      — unexpected failure parsing the ComfyUI response.
		Error("service_unavailable", ErrorResult, "ComfyUI service unavailable")
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/comfyui/models")
			Param("type")
			Response(StatusOK)
			Response("service_unavailable", StatusServiceUnavailable)
			Response("internal_error", StatusInternalServerError)
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
