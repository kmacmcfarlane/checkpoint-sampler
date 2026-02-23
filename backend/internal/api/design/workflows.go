package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("workflows", func() {
	Description("Workflow template management service")

	Method("list", func() {
		Description("List all workflow templates")
		Result(ArrayOf(WorkflowSummary))
		Error("internal_error", ErrorResult, "Internal server error")
		HTTP(func() {
			GET("/api/workflows")
			Response(StatusOK)
			Response("internal_error", StatusInternalServerError)
		})
	})

	Method("show", func() {
		Description("Get workflow template details")
		Payload(func() {
			Attribute("name", String, "Workflow template name")
			Required("name")
		})
		Result(WorkflowDetails)
		Error("not_found", ErrorResult, "Workflow not found")
		HTTP(func() {
			GET("/api/workflows/{name}")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
		})
	})
})

var WorkflowSummary = Type("WorkflowSummary", func() {
	Attribute("name", String, "Workflow template name", func() {
		Example("qwen-image.json")
	})
	Attribute("validation_state", String, "Validation state (valid or invalid)", func() {
		Enum("valid", "invalid")
		Example("valid")
	})
	Attribute("roles", MapOf(String, ArrayOf(String)), "Map of cs_role to node IDs", func() {
		Example(map[string][]string{
			"save_image":  {"9"},
			"unet_loader": {"4"},
			"sampler":     {"3"},
		})
	})
	Attribute("warnings", ArrayOf(String), "Validation warnings (e.g., unknown roles)", func() {
		Example([]string{"unknown cs_role \"custom_role\" on node 5"})
	})
	Required("name", "validation_state", "roles", "warnings")
})

var WorkflowDetails = Type("WorkflowDetails", func() {
	Attribute("name", String, "Workflow template name", func() {
		Example("qwen-image.json")
	})
	Attribute("validation_state", String, "Validation state (valid or invalid)", func() {
		Enum("valid", "invalid")
		Example("valid")
	})
	Attribute("roles", MapOf(String, ArrayOf(String)), "Map of cs_role to node IDs", func() {
		Example(map[string][]string{
			"save_image":  {"9"},
			"unet_loader": {"4"},
			"sampler":     {"3"},
		})
	})
	Attribute("warnings", ArrayOf(String), "Validation warnings (e.g., unknown roles)", func() {
		Example([]string{"unknown cs_role \"custom_role\" on node 5"})
	})
	Attribute("workflow", Any, "Full workflow JSON data", func() {
		Example(map[string]interface{}{
			"3": map[string]interface{}{
				"class_type": "KSampler",
				"_meta":      map[string]interface{}{"cs_role": "sampler"},
			},
		})
	})
	Required("name", "validation_state", "roles", "warnings", "workflow")
})
