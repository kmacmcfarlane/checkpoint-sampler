package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("training_runs", func() {
	Description("Training run management service")

	Method("list", func() {
		Description("List all configured training runs")
		Result(ArrayOf(TrainingRunResponse))
		HTTP(func() {
			GET("/api/training-runs")
			Response(StatusOK)
		})
	})
})

var TrainingRunResponse = Type("TrainingRunResponse", func() {
	Description("A configured training run")
	Attribute("id", Int, "Training run index (zero-based)", func() {
		Example(0)
	})
	Attribute("name", String, "Training run display name", func() {
		Example("psai4rt v0.3.0 qwen")
	})
	Attribute("pattern", String, "Regex pattern for matching directories", func() {
		Example(`^psyart/qwen/psai4rt-v0\.3\.0`)
	})
	Attribute("dimensions", ArrayOf(DimensionConfigResponse), "Directory dimension extraction configs")
	Required("id", "name", "pattern", "dimensions")
})

var DimensionConfigResponse = Type("DimensionConfigResponse", func() {
	Description("A dimension extraction configuration")
	Attribute("name", String, "Dimension name", func() {
		Example("step")
	})
	Attribute("type", String, "Dimension type (int or string)", func() {
		Example("int")
		Enum("int", "string")
	})
	Attribute("pattern", String, "Regex pattern with one capture group", func() {
		Example(`-steps-(\d+)-`)
	})
	Required("name", "type", "pattern")
})
