package model

// PromptRequest represents a prompt submission request to ComfyUI.
type PromptRequest struct {
	Prompt     map[string]interface{}
	ClientID   string
	ExtraData  map[string]interface{}
	FrontQueue bool
}

// PromptResponse represents the response from submitting a prompt to ComfyUI.
type PromptResponse struct {
	PromptID   string
	Number     int
	NodeErrors map[string]interface{}
}

// HistoryResponse represents the history for a prompt.
type HistoryResponse map[string]HistoryEntry

// HistoryEntry represents a single history entry.
type HistoryEntry struct {
	Prompt  []interface{}
	Outputs map[string]interface{}
	Status  map[string]interface{}
}

// ComfyUIEvent represents a WebSocket event from ComfyUI.
type ComfyUIEvent struct {
	Type string
	Data map[string]interface{}
}

// ComfyUIEventHandler is a callback for ComfyUI events.
type ComfyUIEventHandler func(event ComfyUIEvent)

// ObjectInfo represents the schema for a ComfyUI node type.
type ObjectInfo struct {
	Input    ObjectInfoInput
	Output   []string
	Category string
	Name     string
}

// ObjectInfoInput represents the input schema for a node.
type ObjectInfoInput struct {
	Required map[string][]interface{}
	Optional map[string][]interface{}
}
