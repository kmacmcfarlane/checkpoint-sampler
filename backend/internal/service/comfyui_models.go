package service

import (
	"context"
	"fmt"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

// ComfyUIModelType represents the type of model to query.
type ComfyUIModelType string

const (
	ComfyUIModelTypeVAE       ComfyUIModelType = "vae"
	ComfyUIModelTypeCLIP      ComfyUIModelType = "clip"
	ComfyUIModelTypeUNET      ComfyUIModelType = "unet"
	ComfyUIModelTypeSampler   ComfyUIModelType = "sampler"
	ComfyUIModelTypeScheduler ComfyUIModelType = "scheduler"
)

// ObjectInfoGetter defines the interface for retrieving ComfyUI node object info.
type ObjectInfoGetter interface {
	GetObjectInfo(ctx context.Context, nodeType string) (*store.ObjectInfo, error)
}

// ComfyUIModelDiscovery provides model discovery operations.
type ComfyUIModelDiscovery struct {
	client ObjectInfoGetter
}

// NewComfyUIModelDiscovery creates a new model discovery service.
func NewComfyUIModelDiscovery(client ObjectInfoGetter) *ComfyUIModelDiscovery {
	return &ComfyUIModelDiscovery{
		client: client,
	}
}

// GetModels retrieves available models of the specified type.
func (d *ComfyUIModelDiscovery) GetModels(ctx context.Context, modelType ComfyUIModelType) ([]string, error) {
	nodeType := d.nodeTypeForModelType(modelType)
	if nodeType == "" {
		return nil, fmt.Errorf("unsupported model type: %s", modelType)
	}

	info, err := d.client.GetObjectInfo(ctx, nodeType)
	if err != nil {
		return nil, fmt.Errorf("getting object info for %s: %w", nodeType, err)
	}

	models, err := d.extractModels(info, modelType)
	if err != nil {
		return nil, fmt.Errorf("extracting models for %s: %w", modelType, err)
	}

	return models, nil
}

// nodeTypeForModelType maps our model type enum to ComfyUI node types.
func (d *ComfyUIModelDiscovery) nodeTypeForModelType(modelType ComfyUIModelType) string {
	switch modelType {
	case ComfyUIModelTypeVAE:
		return "VAELoader"
	case ComfyUIModelTypeCLIP:
		return "CLIPLoader"
	case ComfyUIModelTypeUNET:
		return "UNETLoader"
	case ComfyUIModelTypeSampler:
		return "KSampler"
	case ComfyUIModelTypeScheduler:
		return "KSampler"
	default:
		return ""
	}
}

// extractModels extracts the list of available models from the ObjectInfo response.
func (d *ComfyUIModelDiscovery) extractModels(info *store.ObjectInfo, modelType ComfyUIModelType) ([]string, error) {
	if info == nil {
		return nil, fmt.Errorf("nil object info")
	}

	// Different node types have different input field names for their model selection
	var fieldName string
	switch modelType {
	case ComfyUIModelTypeVAE:
		fieldName = "vae_name"
	case ComfyUIModelTypeCLIP:
		fieldName = "clip_name"
	case ComfyUIModelTypeUNET:
		fieldName = "unet_name"
	case ComfyUIModelTypeSampler:
		fieldName = "sampler_name"
	case ComfyUIModelTypeScheduler:
		fieldName = "scheduler"
	default:
		return nil, fmt.Errorf("unsupported model type: %s", modelType)
	}

	// Look in the required inputs
	if inputSpec, ok := info.Input.Required[fieldName]; ok {
		return d.parseInputOptions(inputSpec)
	}

	// Look in the optional inputs
	if inputSpec, ok := info.Input.Optional[fieldName]; ok {
		return d.parseInputOptions(inputSpec)
	}

	return nil, fmt.Errorf("field %q not found in object info", fieldName)
}

// parseInputOptions extracts the list of valid options from an input specification.
// ComfyUI input specs are arrays where the first element is often an array of valid choices.
func (d *ComfyUIModelDiscovery) parseInputOptions(inputSpec []interface{}) ([]string, error) {
	if len(inputSpec) == 0 {
		return nil, fmt.Errorf("empty input spec")
	}

	// The first element should be an array of valid choices
	choices, ok := inputSpec[0].([]interface{})
	if !ok {
		return nil, fmt.Errorf("input spec first element is not an array")
	}

	models := make([]string, 0, len(choices))
	for _, choice := range choices {
		if str, ok := choice.(string); ok {
			models = append(models, str)
		}
	}

	return models, nil
}
