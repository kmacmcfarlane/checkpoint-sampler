package store

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/sirupsen/logrus"
)

// ComfyUIHTTPClient provides HTTP operations for interacting with ComfyUI.
type ComfyUIHTTPClient struct {
	baseURL string
	client  *http.Client
	logger  *logrus.Entry
}

// NewComfyUIHTTPClient creates a new ComfyUI HTTP client.
func NewComfyUIHTTPClient(host string, port int, logger *logrus.Logger) *ComfyUIHTTPClient {
	return &ComfyUIHTTPClient{
		baseURL: fmt.Sprintf("http://%s:%d", host, port),
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger.WithField("component", "comfyui_http"),
	}
}

// HealthCheck verifies that ComfyUI is reachable.
func (c *ComfyUIHTTPClient) HealthCheck(ctx context.Context) error {
	c.logger.Trace("entering HealthCheck")
	defer c.logger.Trace("returning from HealthCheck")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/system_stats", nil)
	if err != nil {
		c.logger.WithError(err).Error("failed to create health check request")
		return fmt.Errorf("creating health check request: %w", err)
	}

	c.logger.Debug("performing health check")
	resp, err := c.client.Do(req)
	if err != nil {
		c.logger.WithError(err).Error("health check request failed")
		return fmt.Errorf("health check failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.logger.WithField("status_code", resp.StatusCode).Error("health check returned non-OK status")
		return fmt.Errorf("health check failed with status %d", resp.StatusCode)
	}

	c.logger.Debug("health check successful")
	return nil
}

// PromptRequest represents a prompt submission request.
type PromptRequest struct {
	Prompt     map[string]interface{} `json:"prompt"`
	ClientID   string                 `json:"client_id,omitempty"`
	ExtraData  map[string]interface{} `json:"extra_data,omitempty"`
	FrontQueue bool                   `json:"front,omitempty"`
}

// PromptResponse represents the response from submitting a prompt.
type PromptResponse struct {
	PromptID   string                 `json:"prompt_id"`
	Number     int                    `json:"number"`
	NodeErrors map[string]interface{} `json:"node_errors,omitempty"`
}

// SubmitPrompt sends a prompt to ComfyUI for execution.
func (c *ComfyUIHTTPClient) SubmitPrompt(ctx context.Context, req PromptRequest) (*PromptResponse, error) {
	c.logger.WithField("client_id", req.ClientID).Trace("entering SubmitPrompt")
	defer c.logger.Trace("returning from SubmitPrompt")

	body, err := json.Marshal(req)
	if err != nil {
		c.logger.WithError(err).Error("failed to marshal prompt request")
		return nil, fmt.Errorf("marshaling prompt request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/prompt", bytes.NewReader(body))
	if err != nil {
		c.logger.WithError(err).Error("failed to create prompt request")
		return nil, fmt.Errorf("creating prompt request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	c.logger.Debug("submitting prompt to ComfyUI")
	resp, err := c.client.Do(httpReq)
	if err != nil {
		c.logger.WithError(err).Error("failed to submit prompt")
		return nil, fmt.Errorf("submitting prompt: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		c.logger.WithFields(logrus.Fields{
			"status_code": resp.StatusCode,
			"response":    string(bodyBytes),
		}).Error("prompt submission failed")
		return nil, fmt.Errorf("submit prompt failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	var promptResp PromptResponse
	if err := json.NewDecoder(resp.Body).Decode(&promptResp); err != nil {
		c.logger.WithError(err).Error("failed to decode prompt response")
		return nil, fmt.Errorf("decoding prompt response: %w", err)
	}

	c.logger.WithField("prompt_id", promptResp.PromptID).Info("prompt submitted successfully")
	return &promptResp, nil
}

// HistoryResponse represents the history for a prompt.
type HistoryResponse map[string]HistoryEntry

// HistoryEntry represents a single history entry.
type HistoryEntry struct {
	Prompt  []interface{}          `json:"prompt"`
	Outputs map[string]interface{} `json:"outputs"`
	Status  map[string]interface{} `json:"status"`
}

// GetHistory retrieves the execution history for a prompt.
func (c *ComfyUIHTTPClient) GetHistory(ctx context.Context, promptID string) (HistoryResponse, error) {
	url := c.baseURL + "/history"
	if promptID != "" {
		url = fmt.Sprintf("%s/%s", url, promptID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating history request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("getting history: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get history failed with status %d", resp.StatusCode)
	}

	var historyResp HistoryResponse
	if err := json.NewDecoder(resp.Body).Decode(&historyResp); err != nil {
		return nil, fmt.Errorf("decoding history response: %w", err)
	}

	return historyResp, nil
}

// QueueStatus represents the current queue status.
type QueueStatus struct {
	Pending []QueueItem `json:"queue_pending"`
	Running []QueueItem `json:"queue_running"`
}

// QueueItem represents a single item in the queue.
// ComfyUI returns queue items as JSON arrays (tuples), not objects.
type QueueItem struct {
	Number    int
	PromptID  string
	Prompt    map[string]interface{}
	ExtraData map[string]interface{}
}

// UnmarshalJSON implements custom deserialization for QueueItem.
// ComfyUI returns queue items as arrays: [number, prompt_id, prompt_data, extra_data]
func (q *QueueItem) UnmarshalJSON(data []byte) error {
	var raw []json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	if len(raw) < 4 {
		return fmt.Errorf("queue item array must have at least 4 elements, got %d", len(raw))
	}

	if err := json.Unmarshal(raw[0], &q.Number); err != nil {
		return fmt.Errorf("unmarshaling queue item number: %w", err)
	}

	if err := json.Unmarshal(raw[1], &q.PromptID); err != nil {
		return fmt.Errorf("unmarshaling queue item prompt_id: %w", err)
	}

	if err := json.Unmarshal(raw[2], &q.Prompt); err != nil {
		return fmt.Errorf("unmarshaling queue item prompt: %w", err)
	}

	if err := json.Unmarshal(raw[3], &q.ExtraData); err != nil {
		return fmt.Errorf("unmarshaling queue item extra_data: %w", err)
	}

	return nil
}

// GetQueueStatus retrieves the current queue status.
func (c *ComfyUIHTTPClient) GetQueueStatus(ctx context.Context) (*QueueStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/queue", nil)
	if err != nil {
		return nil, fmt.Errorf("creating queue status request: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("getting queue status: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get queue status failed with status %d", resp.StatusCode)
	}

	var queueStatus QueueStatus
	if err := json.NewDecoder(resp.Body).Decode(&queueStatus); err != nil {
		return nil, fmt.Errorf("decoding queue status response: %w", err)
	}

	return &queueStatus, nil
}

// ObjectInfo represents the schema for a ComfyUI node type.
type ObjectInfo struct {
	Input    ObjectInfoInput `json:"input"`
	Output   []string        `json:"output"`
	Category string          `json:"category"`
	Name     string          `json:"name"`
}

// ObjectInfoInput represents the input schema for a node.
type ObjectInfoInput struct {
	Required map[string][]interface{} `json:"required"`
	Optional map[string][]interface{} `json:"optional"`
}

// GetObjectInfo retrieves the schema for a specific node type.
func (c *ComfyUIHTTPClient) GetObjectInfo(ctx context.Context, nodeType string) (*ObjectInfo, error) {
	c.logger.WithField("node_type", nodeType).Trace("entering GetObjectInfo")
	defer c.logger.Trace("returning from GetObjectInfo")

	url := c.baseURL + "/object_info"
	if nodeType != "" {
		url = fmt.Sprintf("%s/%s", url, nodeType)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		c.logger.WithError(err).Error("failed to create object info request")
		return nil, fmt.Errorf("creating object info request: %w", err)
	}

	c.logger.WithField("node_type", nodeType).Debug("requesting object info from ComfyUI")
	resp, err := c.client.Do(req)
	if err != nil {
		c.logger.WithFields(logrus.Fields{
			"node_type": nodeType,
			"error":     err.Error(),
		}).Error("failed to get object info")
		return nil, fmt.Errorf("getting object info: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.logger.WithFields(logrus.Fields{
			"node_type":   nodeType,
			"status_code": resp.StatusCode,
		}).Error("object info request returned non-OK status")
		return nil, fmt.Errorf("get object info failed with status %d", resp.StatusCode)
	}

	// When requesting a specific node type, the response is a single ObjectInfo
	// wrapped in an object with the node type as the key
	var result map[string]ObjectInfo
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		c.logger.WithError(err).Error("failed to decode object info response")
		return nil, fmt.Errorf("decoding object info response: %w", err)
	}

	if nodeType != "" {
		if info, ok := result[nodeType]; ok {
			c.logger.WithField("node_type", nodeType).Debug("object info retrieved")
			return &info, nil
		}
		c.logger.WithField("node_type", nodeType).Debug("node type not found in response")
		return nil, fmt.Errorf("node type %q not found in response", nodeType)
	}

	// If no specific node type requested, return the first entry (not typical use case)
	for _, info := range result {
		return &info, nil
	}

	return nil, fmt.Errorf("empty object info response")
}
