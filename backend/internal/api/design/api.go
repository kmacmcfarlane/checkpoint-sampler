package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = API("checkpoint_sampler", func() {
	Title("Checkpoint Sampler API")
	Description("API for evaluating stable-diffusion training checkpoint outputs")
	Version("0.1.0")

	Server("checkpoint_sampler", func() {
		Host("localhost", func() {
			URI("http://localhost:8080")
		})
	})

})
