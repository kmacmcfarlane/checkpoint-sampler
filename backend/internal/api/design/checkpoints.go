package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("checkpoints", func() {
	Description("Checkpoint metadata service for reading safetensors training metadata")

	Method("metadata", func() {
		Description("Get training metadata (ss_* fields) from a safetensors checkpoint file header")
		Payload(func() {
			Attribute("filename", String, "Checkpoint filename (e.g. model-step00001000.safetensors)", func() {
				Example("psai4rt-v0.3.0-no-reg-step00004500.safetensors")
			})
			Required("filename")
		})
		Result(CheckpointMetadataResponse)
		Error("not_found", ErrorResult, "Checkpoint file not found")
		Error("invalid_filename", ErrorResult, "Invalid filename (path traversal rejected)")
		HTTP(func() {
			GET("/api/checkpoints/{filename}/metadata")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("invalid_filename", StatusBadRequest)
		})
	})
})

var CheckpointMetadataResponse = Type("CheckpointMetadataResponse", func() {
	Description("Training metadata extracted from a safetensors file header")
	Attribute("metadata", MapOf(String, String), "ss_* metadata fields from the safetensors header", func() {
		Example(map[string]string{
			"ss_output_name": "psai4rt-v0.3.0-no-reg",
			"ss_total_steps": "9000",
			"ss_epoch":       "104",
		})
	})
	Required("metadata")
})
