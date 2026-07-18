package service

import (
	"fmt"
	"net"
	"syscall"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// sequencedPathMatcher is a PathMatcher test double. The first failCalls
// invocations return err; every subsequent invocation returns path. This models
// ComfyUI being unreachable at first (connection error) and then coming back
// online (successful match).
type sequencedPathMatcher struct {
	path      string
	err       error
	failCalls int
	calls     int
}

func (m *sequencedPathMatcher) MatchCheckpointPath(filename string) (string, error) {
	m.calls++
	if m.calls <= m.failCalls {
		return "", m.err
	}
	return m.path, nil
}

// S-161: the executor resolves checkpoint/LoRA model paths lazily at execution
// time. This exercises the offline-create -> reconnect -> drain path and the
// distinction between a connection error (leave pending, retry) and a genuine
// miss (fail the item; job completes with errors).
var _ = Describe("JobExecutor lazy path resolution (S-161)", func() {
	var (
		executor   *JobExecutor
		mockStore  *fakeJobExecutorStore
		mockClient *fakeComfyUIClient
		mockWS     *fakeComfyUIWS
		mockLoader *fakeWorkflowLoader
		mockHub    *fakeEventHub
		mockFS     *fakeFileSystemWriter
		mockFSRead *fakeFileSystemReader
		logger     *logrus.Logger
	)

	// connErr is a transport-level failure that isConnectionError classifies as a
	// connection error (ComfyUI unreachable).
	connErr := &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}
	// missErr is a genuine miss: ComfyUI is up but the checkpoint is absent.
	missErr := fmt.Errorf("checkpoint x not found in ComfyUI UNET models: %w", ErrCheckpointNotResolved)

	BeforeEach(func() {
		mockStore = newFakeJobExecutorStore()
		mockClient = &fakeComfyUIClient{
			promptResponse: &model.PromptResponse{PromptID: "test-prompt-id"},
		}
		mockWS = &fakeComfyUIWS{clientID: "test-client-id"}
		mockLoader = &fakeWorkflowLoader{
			workflow: model.WorkflowTemplate{
				Name: "test-workflow.json",
				Workflow: map[string]interface{}{
					"1": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta":  map[string]interface{}{"cs_role": "unet_loader"},
					},
					"2": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta":  map[string]interface{}{"cs_role": "sampler"},
					},
					"3": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta":  map[string]interface{}{"cs_role": "save_image"},
					},
				},
				Roles: map[string][]string{
					"unet_loader": {"1"},
					"sampler":     {"2"},
					"save_image":  {"3"},
				},
			},
		}
		mockHub = &fakeEventHub{}
		mockFS = newFakeFileSystemWriter()
		mockFSRead = newFakeFileSystemReader()
		logger = logrus.New()
		logger.SetOutput(GinkgoWriter)

		executor = NewJobExecutor(mockStore, mockClient, mockWS, mockLoader, mockHub, "/test/samples", mockFS, mockFSRead, logger)
		executor.mu.Lock()
		executor.connected = true
		executor.mu.Unlock()
	})

	setConnected := func(v bool) {
		executor.mu.Lock()
		executor.connected = v
		executor.mu.Unlock()
	}

	Context("checkpoint job", func() {
		var job model.SampleJob
		var item model.SampleJobItem

		BeforeEach(func() {
			job = model.SampleJob{ID: "job-1", StudyID: "study-1", WorkflowName: "test-workflow.json", Status: model.SampleJobStatusPending}
			item = model.SampleJobItem{
				ID:                 "item-1",
				JobID:              job.ID,
				CheckpointFilename: "cp1.safetensors",
				ComfyUIModelPath:   "", // unresolved at creation (S-161)
				Status:             model.SampleJobItemStatusPending,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}
		})

		// AC: a connection error during execution-time matching leaves the item
		// pending (not failed) and triggers the disconnect/reconnect path.
		It("leaves the item pending on a connection error, then resolves and submits on reconnect", func() {
			matcher := &sequencedPathMatcher{path: "models/cp1.safetensors", err: connErr, failCalls: 1}
			executor.SetPathMatchers(matcher, nil)

			// First attempt: ComfyUI unreachable.
			executor.processNextItem()

			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			Expect(items[0].ComfyUIModelPath).To(BeEmpty())
			Expect(executor.IsConnected()).To(BeFalse())
			Expect(mockClient.lastSubmittedReq).To(BeNil())

			// Reconnect and drain.
			setConnected(true)
			executor.processNextItem()

			items = mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
			Expect(items[0].ComfyUIModelPath).To(Equal("models/cp1.safetensors"))
			Expect(mockClient.lastSubmittedReq).NotTo(BeNil())
			Expect(matcher.calls).To(Equal(2))
		})

		// AC: ComfyUI reachable but checkpoint genuinely absent fails only that item
		// with a clear message; the job completes with errors.
		It("fails the item on a genuine miss and completes the job with errors", func() {
			matcher := &sequencedPathMatcher{err: missErr, failCalls: 1000}
			executor.SetPathMatchers(matcher, nil)

			// First tick fails the item.
			executor.processNextItem()
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(items[0].ErrorMessage).To(ContainSubstring("checkpoint not found in ComfyUI"))
			Expect(executor.IsConnected()).To(BeTrue()) // a genuine miss must NOT drop the connection
			Expect(mockClient.lastSubmittedReq).To(BeNil())

			// Next tick finds no pending items and completes the job with errors.
			executor.processNextItem()
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusCompletedWithErrors))
		})

		// B-152: a reconnect overlapping the executor ticker must not double-submit.
		It("does not re-submit or re-resolve while an item is already in flight", func() {
			matcher := &sequencedPathMatcher{path: "models/cp1.safetensors", err: connErr, failCalls: 0}
			executor.SetPathMatchers(matcher, nil)

			executor.processNextItem()
			Expect(mockClient.lastSubmittedReq).NotTo(BeNil())
			Expect(matcher.calls).To(Equal(1))

			// Simulate an overlapping tick while the item is still in flight
			// (activeItemID set, awaiting WS completion).
			mockClient.lastSubmittedReq = nil
			executor.processNextItem()
			Expect(mockClient.lastSubmittedReq).To(BeNil())
			Expect(matcher.calls).To(Equal(1))
		})
	})

	Context("LoRA job", func() {
		var job model.SampleJob
		var item model.SampleJobItem

		BeforeEach(func() {
			job = model.SampleJob{ID: "lora-job", StudyID: "study-1", WorkflowName: "test-workflow.json", BaseModel: "base.safetensors", Status: model.SampleJobStatusPending}
			item = model.SampleJobItem{
				ID:                 "lora-item",
				JobID:              job.ID,
				CheckpointFilename: "lora1.safetensors",
				LoraModelPath:      "", // unresolved at creation (S-161)
				Status:             model.SampleJobItemStatusPending,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}
		})

		It("leaves the LoRA item pending on a connection error, then resolves on reconnect", func() {
			matcher := &sequencedPathMatcher{path: "loras/lora1.safetensors", err: connErr, failCalls: 1}
			executor.SetPathMatchers(nil, matcher)

			executor.processNextItem()
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			Expect(items[0].LoraModelPath).To(BeEmpty())
			Expect(executor.IsConnected()).To(BeFalse())

			setConnected(true)
			executor.processNextItem()
			items = mockStore.items[job.ID]
			Expect(items[0].LoraModelPath).To(Equal("loras/lora1.safetensors"))
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
			Expect(matcher.calls).To(Equal(2))
		})

		It("fails the LoRA item on a genuine miss and completes the job with errors", func() {
			matcher := &sequencedPathMatcher{err: missErr, failCalls: 1000}
			executor.SetPathMatchers(nil, matcher)

			executor.processNextItem()
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(executor.IsConnected()).To(BeTrue())

			executor.processNextItem()
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusCompletedWithErrors))
		})
	})
})

// B-166: a transient ComfyUI connection error at prompt submission (as opposed to
// path resolution) must also leave the item pending for retry rather than
// permanently failing it. This mirrors the resolveItemModelPaths connection-error
// branch. A genuine submit rejection (ComfyUI reachable, prompt invalid) must
// still fail the item.
var _ = Describe("JobExecutor submit-time connection error (B-166)", func() {
	var (
		executor   *JobExecutor
		mockStore  *fakeJobExecutorStore
		mockClient *fakeComfyUIClient
		mockWS     *fakeComfyUIWS
		mockLoader *fakeWorkflowLoader
		mockHub    *fakeEventHub
		mockFS     *fakeFileSystemWriter
		mockFSRead *fakeFileSystemReader
		logger     *logrus.Logger
		job        model.SampleJob
		item       model.SampleJobItem
	)

	connErr := &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}

	BeforeEach(func() {
		mockStore = newFakeJobExecutorStore()
		mockClient = &fakeComfyUIClient{
			promptResponse: &model.PromptResponse{PromptID: "test-prompt-id"},
		}
		mockWS = &fakeComfyUIWS{clientID: "test-client-id"}
		mockLoader = &fakeWorkflowLoader{
			workflow: model.WorkflowTemplate{
				Name: "test-workflow.json",
				Workflow: map[string]interface{}{
					"1": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta":  map[string]interface{}{"cs_role": "unet_loader"},
					},
					"2": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta":  map[string]interface{}{"cs_role": "sampler"},
					},
					"3": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta":  map[string]interface{}{"cs_role": "save_image"},
					},
				},
				Roles: map[string][]string{
					"unet_loader": {"1"},
					"sampler":     {"2"},
					"save_image":  {"3"},
				},
			},
		}
		mockHub = &fakeEventHub{}
		mockFS = newFakeFileSystemWriter()
		mockFSRead = newFakeFileSystemReader()
		logger = logrus.New()
		logger.SetOutput(GinkgoWriter)

		executor = NewJobExecutor(mockStore, mockClient, mockWS, mockLoader, mockHub, "/test/samples", mockFS, mockFSRead, logger)
		executor.mu.Lock()
		executor.connected = true
		executor.mu.Unlock()

		// Item already has a resolved path so resolveItemModelPaths short-circuits
		// and processItem proceeds straight through to SubmitPrompt.
		job = model.SampleJob{ID: "job-submit", StudyID: "study-1", WorkflowName: "test-workflow.json", Status: model.SampleJobStatusPending}
		item = model.SampleJobItem{
			ID:                 "item-submit-1",
			JobID:              job.ID,
			CheckpointFilename: "cp1.safetensors",
			ComfyUIModelPath:   "models/cp1.safetensors",
			Status:             model.SampleJobItemStatusPending,
		}
		mockStore.jobs[job.ID] = job
		mockStore.items[job.ID] = []model.SampleJobItem{item}
	})

	// AC: a connection error at SubmitPrompt leaves the item pending (not failed),
	// clears active state, and marks the executor disconnected so the reconnect
	// ticker re-selects the item once ComfyUI returns.
	It("leaves the item pending (not failed) on a connection error at submit, and resumes on reconnect", func() {
		mockClient.submitErr = connErr

		executor.processNextItem()

		items := mockStore.items[job.ID]
		Expect(items[0].Status).NotTo(Equal(model.SampleJobItemStatusFailed))
		Expect(executor.IsConnected()).To(BeFalse())
		executor.mu.Lock()
		activeItemID := executor.activeItemID
		activePromptID := executor.activePromptID
		executor.mu.Unlock()
		Expect(activeItemID).To(BeEmpty())
		Expect(activePromptID).To(BeEmpty())

		// Reconnect: the item (orphaned to "running" by the failed submit, or still
		// pending) is picked up and resubmitted successfully.
		mockClient.submitErr = nil
		executor.mu.Lock()
		executor.connected = true
		executor.mu.Unlock()
		executor.processNextItem()

		items = mockStore.items[job.ID]
		Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
		Expect(mockClient.lastSubmittedReq).NotTo(BeNil())
	})

	// AC: a genuine submit rejection (ComfyUI reachable, prompt invalid) must still
	// fail the item — only connection errors are retried.
	It("fails the item on a genuine (non-connection) submit rejection", func() {
		mockClient.submitErr = fmt.Errorf("invalid prompt: missing required field")

		executor.processNextItem()

		items := mockStore.items[job.ID]
		Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
		Expect(items[0].ErrorMessage).To(ContainSubstring("ComfyUI prompt submission failed"))
		Expect(executor.IsConnected()).To(BeTrue())
	})
})
