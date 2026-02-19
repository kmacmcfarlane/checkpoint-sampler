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

	Method("scan", func() {
		Description("Scan a training run's directories and return image metadata with discovered dimensions")
		Payload(func() {
			Attribute("id", Int, "Training run index (zero-based)", func() {
				Minimum(0)
			})
			Required("id")
		})
		Result(ScanResultResponse)
		Error("not_found", ErrorResult, "Training run not found")
		Error("scan_failed", ErrorResult, "Scan operation failed")
		HTTP(func() {
			GET("/api/training-runs/{id}/scan")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("scan_failed", StatusInternalServerError)
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

var ScanResultResponse = Type("ScanResultResponse", func() {
	Description("Result of scanning a training run's directories")
	Attribute("images", ArrayOf(ImageResponse), "Discovered images with dimension values")
	Attribute("dimensions", ArrayOf(DimensionResponse), "Discovered dimensions with unique values")
	Required("images", "dimensions")
})

var ImageResponse = Type("ImageResponse", func() {
	Description("A discovered image with its dimension values")
	Attribute("relative_path", String, "Image path relative to dataset root", func() {
		Example("psyart/qwen/run-steps-1000/index=5&prompt_name=portal&seed=42&cfg=3&_00001_.png")
	})
	Attribute("dimensions", MapOf(String, String), "Dimension key-value pairs for this image", func() {
		Example(map[string]string{"step": "1000", "prompt_name": "portal", "seed": "42"})
	})
	Required("relative_path", "dimensions")
})

var DimensionResponse = Type("DimensionResponse", func() {
	Description("A discovered dimension with its unique values")
	Attribute("name", String, "Dimension name", func() {
		Example("step")
	})
	Attribute("type", String, "Dimension type (int or string)", func() {
		Example("int")
		Enum("int", "string")
	})
	Attribute("values", ArrayOf(String), "Sorted unique values for this dimension", func() {
		Example([]string{"500", "1000", "1500"})
	})
	Required("name", "type", "values")
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
