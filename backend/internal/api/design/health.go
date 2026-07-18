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

	Method("config", func() {
		Description("Expose UI-relevant configuration limits to the frontend")
		Result(ConfigResult)
		HTTP(func() {
			GET("/api/v1/config")
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

var ConfigResult = Type("ConfigResult", func() {
	Description("UI-relevant configuration limits")
	Attribute("max_study_items", Int, "Maximum total work items allowed per study/job", func() {
		Example(50000)
	})
	Required("max_study_items")
})
