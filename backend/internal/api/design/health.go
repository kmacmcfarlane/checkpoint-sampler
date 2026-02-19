package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("health", func() {
	Description("Health check service")

	Method("check", func() {
		Description("Health check endpoint")
		Result(HealthResult)
		HTTP(func() {
			GET("/health")
			Response(StatusOK)
		})
	})
})

var HealthResult = Type("HealthResult", func() {
	Attribute("status", String, "Health status", func() {
		Example("ok")
	})
	Required("status")
})
