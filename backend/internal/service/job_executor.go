package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// JobExecutorStore defines the persistence operations the job executor needs.
type JobExecutorStore interface {
	GetSampleJob(id string) (model.SampleJob, error)
	UpdateSampleJob(j model.SampleJob) error
	// RecalculateCompletedItems atomically derives the stored completed_items
	// counter from the count of completed sample_job_items in a single UPDATE,
	// eliminating the get-modify-write race. Returns the recomputed count.
	RecalculateCompletedItems(jobID string) (int, error)
	ListSampleJobItems(jobID string) ([]model.SampleJobItem, error)
	UpdateSampleJobItem(i model.SampleJobItem) error
	ListSampleJobs() ([]model.SampleJob, error)
	GetStudy(id string) (model.Study, error)
}

// ComfyUIClient defines the interface for ComfyUI HTTP operations.
type ComfyUIClient interface {
	SubmitPrompt(ctx context.Context, req model.PromptRequest) (*model.PromptResponse, error)
	GetHistory(ctx context.Context, promptID string) (model.HistoryResponse, error)
	DownloadImage(ctx context.Context, filename string, subfolder string, folderType string) ([]byte, error)
	CancelPrompt(ctx context.Context, promptID string) error
}

// ComfyUIWS defines the interface for ComfyUI WebSocket operations.
type ComfyUIWS interface {
	AddHandler(handler model.ComfyUIEventHandler)
	// SetDisconnectHandler registers a callback that is invoked when the
	// WebSocket connection is lost (e.g. readLoop exits due to a read error).
	// The executor uses this to mark itself as disconnected and clear stale
	// active state so the reconnection ticker can re-establish the connection.
	SetDisconnectHandler(handler func())
	Connect(ctx context.Context) error
	Close() error
	// GetClientID returns the unique client ID for this WebSocket session.
	// It must be sent with every prompt submission so ComfyUI routes prompt-specific
	// events (executing, executed, execution_error) back to this connection.
	GetClientID() string
}

// WorkflowLoaderService defines the interface for loading workflow templates.
type WorkflowLoaderService interface {
	Get(ctx context.Context, name string) (model.WorkflowTemplate, error)
}

// EventHub defines the interface for broadcasting events to clients.
type EventHub interface {
	Broadcast(event model.FSEvent)
}

// sampleTimingWindowSize is the number of recent sample durations used for
// the moving average ETA calculation.
const sampleTimingWindowSize = 10

// JobExecutor executes sample jobs in the background.
type JobExecutor struct {
	store             JobExecutorStore
	comfyuiClient     ComfyUIClient
	comfyuiWS         ComfyUIWS
	workflowLoader    WorkflowLoaderService
	hub               EventHub
	sampleDir         string
	fsWriter          FileSystemWriter
	fsReader          FileSystemReader
	thumbGen          *ThumbnailGenerator // nil if thumbnail generation is disabled
	reconnectInterval time.Duration
	logger            *logrus.Entry

	dirRemover SampleDirRemover // optional; used for clear-existing at job start

	// baseModelMatcher resolves a curated base_model_dir relative path to the
	// authoritative ComfyUI unet_name for LoRA jobs. Optional: when nil, the
	// raw job.BaseModel is submitted unchanged (preserves legacy behavior for
	// tests and ComfyUI-disabled setups).
	baseModelMatcher ComfyUIModelsProvider

	// checkpointMatcher and loraMatcher resolve a checkpoint/LoRA filename to the
	// ComfyUI model path lazily at execution time (S-161). Jobs are created with
	// unresolved paths so queuing does not require ComfyUI to be reachable; the
	// executor resolves the path when it first processes an item whose path is
	// empty. Optional: when nil, resolution is skipped and the item's stored path
	// (possibly empty) is used unchanged, preserving legacy behavior for tests and
	// ComfyUI-disabled setups.
	checkpointMatcher PathMatcher
	loraMatcher       PathMatcher

	mu                     sync.Mutex
	activeJobID            string
	activeItemID           string
	activePromptID         string
	connected              bool
	everConnected          bool // true after the first successful connection; distinguishes reconnects from the initial connect
	paused                 bool
	checkpointCompleteness map[string]model.CheckpointCompletenessInfo
	ctx                    context.Context
	cancel                 context.CancelFunc
	shutdownCh             chan struct{}
	shutdownComplete       chan struct{}
	started                bool

	// sampleStartTime records when the current sample began processing.
	// Set in processItem, read in handleItemCompletionAsync.
	sampleStartTime time.Time
	// sampleTiming tracks the moving average of recent sample generation durations.
	sampleTiming *MovingAverage
	// timeNow is a function that returns the current time, injected for testability.
	timeNow func() time.Time
}

// NewJobExecutor creates a new job executor without thumbnail generation.
func NewJobExecutor(
	store JobExecutorStore,
	comfyuiClient ComfyUIClient,
	comfyuiWS ComfyUIWS,
	workflowLoader WorkflowLoaderService,
	hub EventHub,
	sampleDir string,
	fsWriter FileSystemWriter,
	fsReader FileSystemReader,
	logger *logrus.Logger,
) *JobExecutor {
	return NewJobExecutorWithThumbnails(store, comfyuiClient, comfyuiWS, workflowLoader, hub, sampleDir, fsWriter, fsReader, nil, 10*time.Second, logger)
}

// NewJobExecutorWithThumbnails creates a new job executor with optional thumbnail generation.
// Pass nil for thumbGen to disable thumbnail generation.
// reconnectInterval controls how often the executor retries a disconnected ComfyUI WebSocket connection.
func NewJobExecutorWithThumbnails(
	store JobExecutorStore,
	comfyuiClient ComfyUIClient,
	comfyuiWS ComfyUIWS,
	workflowLoader WorkflowLoaderService,
	hub EventHub,
	sampleDir string,
	fsWriter FileSystemWriter,
	fsReader FileSystemReader,
	thumbGen *ThumbnailGenerator,
	reconnectInterval time.Duration,
	logger *logrus.Logger,
) *JobExecutor {
	ctx, cancel := context.WithCancel(context.Background())
	return &JobExecutor{
		store:                  store,
		comfyuiClient:          comfyuiClient,
		comfyuiWS:              comfyuiWS,
		workflowLoader:         workflowLoader,
		hub:                    hub,
		sampleDir:              sampleDir,
		fsWriter:               fsWriter,
		fsReader:               fsReader,
		thumbGen:               thumbGen,
		reconnectInterval:      reconnectInterval,
		logger:                 logger.WithField("component", "job_executor"),
		checkpointCompleteness: make(map[string]model.CheckpointCompletenessInfo),
		ctx:                    ctx,
		cancel:                 cancel,
		shutdownCh:             make(chan struct{}),
		shutdownComplete:       make(chan struct{}),
		sampleTiming:           NewMovingAverage(sampleTimingWindowSize),
		timeNow:                time.Now,
	}
}

// SetDirRemover sets the sample directory remover used for clear-existing at job start.
// This is optional; if not set, clear_existing jobs will skip filesystem cleanup.
func (e *JobExecutor) SetDirRemover(remover SampleDirRemover) {
	e.dirRemover = remover
}

// SetBaseModelMatcher wires the ComfyUI models provider used to resolve a
// curated base_model_dir relative path to the authoritative unet_name before
// submitting a LoRA job. When unset, the raw job.BaseModel is submitted
// unchanged.
func (e *JobExecutor) SetBaseModelMatcher(provider ComfyUIModelsProvider) {
	e.baseModelMatcher = provider
}

// SetPathMatchers wires the checkpoint and LoRA path matchers used to resolve a
// checkpoint/LoRA filename to a ComfyUI model path lazily at execution time
// (S-161). Either may be nil; when nil, resolution for that job kind is skipped
// and the item's stored path is used unchanged.
func (e *JobExecutor) SetPathMatchers(checkpointMatcher PathMatcher, loraMatcher PathMatcher) {
	e.checkpointMatcher = checkpointMatcher
	e.loraMatcher = loraMatcher
}

// deepCloneWorkflow performs a deep clone of a workflow map.
func deepCloneWorkflow(workflow map[string]interface{}) (map[string]interface{}, error) {
	data, err := json.Marshal(workflow)
	if err != nil {
		return nil, fmt.Errorf("marshaling workflow for cloning: %w", err)
	}
	var cloned map[string]interface{}
	if err := json.Unmarshal(data, &cloned); err != nil {
		return nil, fmt.Errorf("unmarshaling cloned workflow: %w", err)
	}
	return cloned, nil
}

// toInt extracts an integer value from a JSON-decoded interface{}.
// JSON numbers are decoded as float64 by encoding/json; this function
// handles both float64 and direct int/int64 types.
func toInt(v interface{}) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	default:
		return 0, false
	}
}

// composeExecutionErrorMessage builds a human-readable error summary from ComfyUI
// execution_error event fields. Format: "[ExceptionType] NodeType: message"
func composeExecutionErrorMessage(exceptionType, nodeType, exceptionMessage string) string {
	if exceptionMessage == "" {
		exceptionMessage = "unknown error"
	}
	parts := make([]string, 0, 3)
	if exceptionType != "" {
		parts = append(parts, fmt.Sprintf("[%s]", exceptionType))
	}
	if nodeType != "" {
		parts = append(parts, fmt.Sprintf("%s:", nodeType))
	}
	parts = append(parts, exceptionMessage)
	return strings.Join(parts, " ")
}

// isConnectionError detects whether err represents a transport-level failure
// talking to ComfyUI (so the executor should mark the connection dead and
// reconnect). It uses typed checks (errors.As / errors.Is) instead of matching
// error message substrings: a ComfyUI *node* execution error whose human text
// merely mentions "network", "timeout", etc. must NOT be misclassified as a
// connection error and trigger a bogus reconnect cycle.
func isConnectionError(err error) bool {
	if err == nil {
		return false
	}

	// Timeouts surfaced by the net stack (e.g. dial/read/write deadline exceeded).
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}

	// Context deadline exceeded (request timed out before a response).
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	// Low-level network operation failures (dial/read/write on the socket).
	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return true
	}

	// Syscall errno conditions that indicate the peer/socket is gone.
	var errno syscall.Errno
	if errors.As(err, &errno) {
		switch errno {
		case syscall.ECONNREFUSED, syscall.ECONNRESET, syscall.EPIPE, syscall.ECONNABORTED, syscall.ENETUNREACH, syscall.EHOSTUNREACH:
			return true
		}
	}

	// Connection closed mid-response.
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}

	return false
}
