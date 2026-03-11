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

var CheckpointCompletenessInfo = Type("CheckpointCompletenessInfo", func() {
	Description("Result of verifying expected images exist on disk for a completed checkpoint")
	Attribute("checkpoint", String, "Checkpoint filename")
	Attribute("expected", Int, "Number of expected images")
	Attribute("verified", Int, "Number of images verified on disk")
	Attribute("missing", Int, "Number of missing images")
	Required("checkpoint", "expected", "verified", "missing")
})

var WSFailedItemDetail = Type("WSFailedItemDetail", func() {
	Description("Details of a failed checkpoint in a job progress WebSocket event")
	Attribute("checkpoint_filename", String, "Checkpoint filename that failed")
	Attribute("error_message", String, "Error message describing the failure")
	Attribute("exception_type", String, "Python exception type (e.g. RuntimeError)")
	Attribute("node_type", String, "ComfyUI node type that failed (e.g. VAEDecode)")
	Attribute("traceback", String, "Full Python stack trace")
	Required("checkpoint_filename", "error_message")
})

var WSSampleParams = Type("WSSampleParams", func() {
	Description("Generation parameters for the sample currently being generated (only present when a sample is actively running)")
	Attribute("checkpoint_filename", String, "Checkpoint filename being sampled (e.g. step-000010.safetensors)")
	Attribute("prompt_name", String, "Named prompt slot in use (e.g. forest)")
	Attribute("cfg", Float64, "Classifier-free guidance scale (floating-point)")
	Attribute("steps", Int, "Number of sampler steps (integer)")
	Attribute("sampler_name", String, "ComfyUI sampler name (e.g. euler)")
	Attribute("scheduler", String, "ComfyUI scheduler name (e.g. normal)")
	Attribute("seed", Int64, "Generation seed")
	Attribute("width", Int, "Output image width in pixels")
	Attribute("height", Int, "Output image height in pixels")
	Required("checkpoint_filename", "prompt_name", "cfg", "steps", "sampler_name", "scheduler", "seed", "width", "height")
})

var FSEventResponse = Type("FSEventResponse", func() {
	Description("A filesystem change event or job progress update pushed to WebSocket clients")
	Attribute("type", String, "Event type", func() {
		Enum("image_added", "image_removed", "directory_added", "job_progress", "inference_progress")
		Example("image_added")
	})
	Attribute("path", String, "Path relative to the sample directory", func() {
		Example("checkpoint.safetensors/index=0&prompt_name=forest&seed=420&cfg=1&_00001_.png")
	})
	// Job progress fields (only present when type=job_progress)
	Attribute("job_id", String, "Job ID (only for job_progress events)")
	Attribute("status", String, "Job status (only for job_progress events)")
	Attribute("total_items", Int, "Total work items (only for job_progress events)")
	Attribute("completed_items", Int, "Completed work items (only for job_progress events)")
	Attribute("failed_items", Int, "Failed work items (only for job_progress events)")
	Attribute("pending_items", Int, "Pending work items (only for job_progress events)")
	Attribute("checkpoints_completed", Int, "Fully completed checkpoints (only for job_progress events)")
	Attribute("total_checkpoints", Int, "Total checkpoints (only for job_progress events)")
	Attribute("current_checkpoint", String, "Current checkpoint being processed (only for job_progress events)")
	Attribute("current_checkpoint_progress", Int, "Items completed in current checkpoint (only for job_progress events)")
	Attribute("current_checkpoint_total", Int, "Total items in current checkpoint (only for job_progress events)")
	Attribute("checkpoint_completeness", ArrayOf(CheckpointCompletenessInfo), "Per-checkpoint completeness verification results (only for job_progress events)")
	Attribute("failed_item_details", ArrayOf(WSFailedItemDetail), "Details of failed checkpoints with error info (only for job_progress events)")
	Attribute("sample_eta_seconds", Float64, "Estimated seconds remaining for the current sample (only for job_progress events, 0 if unavailable)")
	Attribute("job_eta_seconds", Float64, "Estimated seconds remaining for the entire job (only for job_progress events, 0 if unavailable)")
	Attribute("current_sample_params", WSSampleParams, "Generation parameters for the currently generating sample (only present when a sample is actively running)")
	// Inference progress fields (only present when type=inference_progress)
	Attribute("prompt_id", String, "ComfyUI prompt ID (only for inference_progress events)")
	Attribute("current_value", Int, "Current inference step (only for inference_progress events)")
	Attribute("max_value", Int, "Total inference steps (only for inference_progress events)")
	Required("type", "path")
})
