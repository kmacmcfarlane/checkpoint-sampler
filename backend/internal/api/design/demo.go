package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("demo", func() {
	Description("Demo dataset management service")

	Method("status", func() {
		Description("Check whether the demo dataset is installed")
		Result(DemoStatusResponse)
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/demo/status")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("install", func() {
		Description("Install the demo dataset and seed the demo preset")
		Result(DemoStatusResponse)
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			POST("/api/demo/install")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("uninstall", func() {
		Description("Remove the demo dataset and demo preset")
		Result(DemoStatusResponse)
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			DELETE("/api/demo")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})
})

var DemoStatusResponse = Type("DemoStatusResponse", func() {
	Description("Demo dataset installation status")
	Attribute("installed", Boolean, "Whether the demo dataset is currently installed", func() {
		Example(true)
	})
	Required("installed")
})
