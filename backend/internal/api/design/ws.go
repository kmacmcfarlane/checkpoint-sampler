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
	Description("A filesystem change event or job progress update pushed to WebSocket clients")
	Attribute("type", String, "Event type", func() {
		Enum("image_added", "image_removed", "directory_added", "job_progress")
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
	Required("type", "path")
})
