package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("docs", func() {
	Description("Swagger UI and OpenAPI spec service")

	// Serve the OpenAPI spec JSON
	Method("openapi", func() {
		Description("Serve the OpenAPI 3.0 specification")
		Result(Bytes)
		HTTP(func() {
			GET("/docs/openapi3.json")
			Response(StatusOK, func() {
				ContentType("application/json")
			})
		})
	})

	// Serve Swagger UI files
	Files("/docs/{*path}", "public/swagger-ui/")
})

