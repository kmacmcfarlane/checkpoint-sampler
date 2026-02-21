package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("ws", func() {
	Description("WebSocket service for live filesystem update events")

	Method("subscribe", func() {
		Description("Subscribe to filesystem change events via WebSocket")
		StreamingResult(FSEventResponse)
		HTTP(func() {
			GET("/api/ws")
			Response(StatusOK)
		})
	})
})

var FSEventResponse = Type("FSEventResponse", func() {
	Description("A filesystem change event pushed to WebSocket clients")
	Attribute("type", String, "Event type", func() {
		Enum("image_added", "image_removed", "directory_added")
		Example("image_added")
	})
	Attribute("path", String, "Path relative to the sample directory", func() {
		Example("checkpoint.safetensors/index=0&prompt_name=forest&seed=420&cfg=1&_00001_.png")
	})
	Required("type", "path")
})
