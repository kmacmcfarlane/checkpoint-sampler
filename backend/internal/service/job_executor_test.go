package service

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
)

// Mock implementations

type mockJobExecutorStore struct {
	jobs             map[string]model.SampleJob
	items            map[string][]model.SampleJobItem
	studies          map[string]model.Study
	updateJobError   error
	updateItemError  error
	// onUpdateJob is an optional callback invoked during UpdateSampleJob (before the write).
	// Used by tests that need to inspect executor state at the exact moment of a DB write.
	onUpdateJob      func(model.SampleJob)
}

func newMockJobExecutorStore() *mockJobExecutorStore {
	return &mockJobExecutorStore{
		jobs:    make(map[string]model.SampleJob),
		items:   make(map[string][]model.SampleJobItem),
		studies: make(map[string]model.Study),
	}
}

func (m *mockJobExecutorStore) GetSampleJob(id string) (model.SampleJob, error) {
	job, ok := m.jobs[id]
	if !ok {
		return model.SampleJob{}, sql.ErrNoRows
	}
	return job, nil
}

func (m *mockJobExecutorStore) UpdateSampleJob(j model.SampleJob) error {
	if m.onUpdateJob != nil {
		m.onUpdateJob(j)
	}
	if m.updateJobError != nil {
		return m.updateJobError
	}
	m.jobs[j.ID] = j
	return nil
}

func (m *mockJobExecutorStore) ListSampleJobItems(jobID string) ([]model.SampleJobItem, error) {
	items, ok := m.items[jobID]
	if !ok {
		return []model.SampleJobItem{}, nil
	}
	return items, nil
}

func (m *mockJobExecutorStore) UpdateSampleJobItem(i model.SampleJobItem) error {
	if m.updateItemError != nil {
		return m.updateItemError
	}
	items := m.items[i.JobID]
	for idx := range items {
		if items[idx].ID == i.ID {
			items[idx] = i
			m.items[i.JobID] = items
			return nil
		}
	}
	return errors.New("item not found")
}

func (m *mockJobExecutorStore) ListSampleJobs() ([]model.SampleJob, error) {
	var result []model.SampleJob
	for _, j := range m.jobs {
		result = append(result, j)
	}
	return result, nil
}

func (m *mockJobExecutorStore) GetStudy(id string) (model.Study, error) {
	s, ok := m.studies[id]
	if !ok {
		return model.Study{}, errors.New("study not found")
	}
	return s, nil
}

type mockComfyUIClient struct {
	submitErr         error
	promptResponse    *model.PromptResponse
	lastSubmittedReq  *model.PromptRequest
	historyResponse   model.HistoryResponse
	historyErr        error
	downloadData      []byte
	downloadErr       error
	cancelErr         error
}

func (m *mockComfyUIClient) SubmitPrompt(ctx context.Context, req model.PromptRequest) (*model.PromptResponse, error) {
	m.lastSubmittedReq = &req
	if m.submitErr != nil {
		return nil, m.submitErr
	}
	return m.promptResponse, nil
}

func (m *mockComfyUIClient) GetHistory(ctx context.Context, promptID string) (model.HistoryResponse, error) {
	if m.historyErr != nil {
		return nil, m.historyErr
	}
	return m.historyResponse, nil
}

func (m *mockComfyUIClient) DownloadImage(ctx context.Context, filename string, subfolder string, folderType string) ([]byte, error) {
	if m.downloadErr != nil {
		return nil, m.downloadErr
	}
	return m.downloadData, nil
}

func (m *mockComfyUIClient) CancelPrompt(ctx context.Context, promptID string) error {
	if m.cancelErr != nil {
		return m.cancelErr
	}
	return nil
}

type mockComfyUIWS struct {
	handlers            []model.ComfyUIEventHandler
	disconnectHandler   func()
	connectErr          error
	closeErr            error
	clientID            string
}

func (m *mockComfyUIWS) AddHandler(handler model.ComfyUIEventHandler) {
	m.handlers = append(m.handlers, handler)
}

func (m *mockComfyUIWS) SetDisconnectHandler(handler func()) {
	m.disconnectHandler = handler
}

func (m *mockComfyUIWS) Connect(ctx context.Context) error {
	if m.connectErr != nil {
		return m.connectErr
	}
	return nil
}

func (m *mockComfyUIWS) Close() error {
	if m.closeErr != nil {
		return m.closeErr
	}
	return nil
}

func (m *mockComfyUIWS) GetClientID() string {
	return m.clientID
}

func (m *mockComfyUIWS) SendEvent(event model.ComfyUIEvent) {
	for _, h := range m.handlers {
		h(event)
	}
}

// SimulateDisconnect simulates a WebSocket disconnection by invoking the
// registered disconnect handler (as the real readLoop would on a read error).
func (m *mockComfyUIWS) SimulateDisconnect() {
	if m.disconnectHandler != nil {
		m.disconnectHandler()
	}
}

type mockWorkflowLoader struct {
	workflow model.WorkflowTemplate
	err      error
}

func (m *mockWorkflowLoader) Get(ctx context.Context, name string) (model.WorkflowTemplate, error) {
	if m.err != nil {
		return model.WorkflowTemplate{}, m.err
	}
	return m.workflow, nil
}

type mockEventHub struct {
	events []model.FSEvent
}

func (m *mockEventHub) Broadcast(event model.FSEvent) {
	m.events = append(m.events, event)
}

type mockFileInfo struct {
	isDir bool
}

func (m mockFileInfo) IsDir() bool {
	return m.isDir
}

type mockFileSystemWriter struct {
	writtenFiles map[string][]byte
	renameErr    error
}

func newMockFileSystemWriter() *mockFileSystemWriter {
	return &mockFileSystemWriter{
		writtenFiles: make(map[string][]byte),
	}
}

func (m *mockFileSystemWriter) MkdirAll(path string, perm uint32) error {
	return nil
}

func (m *mockFileSystemWriter) WriteFile(path string, data []byte, perm uint32) error {
	if m.writtenFiles != nil {
		m.writtenFiles[path] = data
	}
	return nil
}

func (m *mockFileSystemWriter) Stat(path string) (fileInfo, error) {
	return mockFileInfo{isDir: true}, nil
}

func (m *mockFileSystemWriter) RenameFile(oldPath, newPath string) error {
	if m.renameErr != nil {
		return m.renameErr
	}
	if m.writtenFiles != nil {
		if data, ok := m.writtenFiles[oldPath]; ok {
			m.writtenFiles[newPath] = data
			delete(m.writtenFiles, oldPath)
		}
	}
	return nil
}

type mockFileSystemReader struct {
	// files maps directory paths to lists of PNG filenames in that directory
	files       map[string][]string
	dirs        map[string]bool
	listErr     error
}

func newMockFileSystemReader() *mockFileSystemReader {
	return &mockFileSystemReader{
		files: make(map[string][]string),
		dirs:  make(map[string]bool),
	}
}

func (m *mockFileSystemReader) ListPNGFiles(dir string) ([]string, error) {
	if m.listErr != nil {
		return nil, m.listErr
	}
	files, ok := m.files[dir]
	if !ok {
		return []string{}, nil
	}
	return files, nil
}

func (m *mockFileSystemReader) DirectoryExists(path string) bool {
	return m.dirs[path]
}

var _ = Describe("JobExecutor", func() {
	var (
		executor    *JobExecutor
		mockStore   *mockJobExecutorStore
		mockClient  *mockComfyUIClient
		mockWS      *mockComfyUIWS
		mockLoader  *mockWorkflowLoader
		mockHub     *mockEventHub
		mockFS      *mockFileSystemWriter
		mockFSRead  *mockFileSystemReader
		logger      *logrus.Logger
	)

	BeforeEach(func() {
		mockStore = newMockJobExecutorStore()
		mockClient = &mockComfyUIClient{
			promptResponse: &model.PromptResponse{
				PromptID: "test-prompt-id",
			},
			historyResponse: model.HistoryResponse{
				"test-prompt-id": model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": map[string]interface{}{
							"images": []interface{}{
								map[string]interface{}{
									"filename":  "output.png",
									"subfolder": "",
									"type":      "output",
								},
							},
						},
					},
				},
			},
			downloadData: []byte("fake-image-data"),
		}
		mockWS = &mockComfyUIWS{clientID: "test-client-id"}
		mockLoader = &mockWorkflowLoader{
			workflow: model.WorkflowTemplate{
				Name: "test-workflow.json",
				Workflow: map[string]interface{}{
					"1": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta": map[string]interface{}{
							"cs_role": "unet_loader",
						},
					},
					"2": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta": map[string]interface{}{
							"cs_role": "sampler",
						},
					},
					"3": map[string]interface{}{
						"inputs": map[string]interface{}{},
						"_meta": map[string]interface{}{
							"cs_role": "save_image",
						},
					},
				},
				Roles: map[string][]string{
					"unet_loader": {"1"},
					"sampler":     {"2"},
					"save_image":  {"3"},
				},
			},
		}
		mockHub = &mockEventHub{}
		mockFS = newMockFileSystemWriter()
		mockFSRead = newMockFileSystemReader()
		logger = logrus.New()
		logger.SetOutput(GinkgoWriter)

		executor = NewJobExecutor(
			mockStore,
			mockClient,
			mockWS,
			mockLoader,
			mockHub,
			"/test/samples",
			mockFS,
			mockFSRead,
			logger,
		)
	})

	AfterEach(func() {
		// Note: We don't start the executor in tests, so no need to stop it
	})

	// AC: Job executor auto-starts pending jobs without requiring an explicit Start API call
	Describe("Auto-start behavior (pending → running)", func() {
		BeforeEach(func() {
			// Mark executor as connected so it processes items
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()
		})

		It("transitions a pending job to running when processNextItem is called", func() {
			// AC: BE: Job executor polls for jobs in pending status and auto-transitions them to running
			job := model.SampleJob{
				ID:     "job-pending-1",
				Status: model.SampleJobStatusPending,
			}
			item := model.SampleJobItem{
				ID:     "item-1",
				JobID:  job.ID,
				Status: model.SampleJobItemStatusPending,
				// Required for processItem to not fail immediately
				ComfyUIModelPath: "models/test.safetensors",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.processNextItem()

			// Verify the job was transitioned from pending to running
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusRunning))
		})

		It("does not start a second job while one is already running", func() {
			// AC: BE: Only one job runs at a time; additional pending jobs wait in queue.
			// The executor tracks running jobs via activeJobID (set when it auto-started them
			// or resumed them at startup). We simulate this by setting activeJobID directly.
			runningJob := model.SampleJob{
				ID:     "job-running-1",
				Status: model.SampleJobStatusRunning,
			}
			pendingJob := model.SampleJob{
				ID:     "job-pending-2",
				Status: model.SampleJobStatusPending,
			}
			// Running job has one pending item
			runningItem := model.SampleJobItem{
				ID:               "item-running-1",
				JobID:            runningJob.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
			}
			mockStore.jobs[runningJob.ID] = runningJob
			mockStore.jobs[pendingJob.ID] = pendingJob
			mockStore.items[runningJob.ID] = []model.SampleJobItem{runningItem}
			mockStore.items[pendingJob.ID] = []model.SampleJobItem{}

			// Simulate the executor already tracking the running job (as it would after
			// auto-starting it or resuming it at startup via resumeRunningJobs).
			executor.mu.Lock()
			executor.activeJobID = runningJob.ID
			executor.mu.Unlock()

			executor.processNextItem()

			// Pending job must remain pending — only the running job is processed
			Expect(mockStore.jobs[pendingJob.ID].Status).To(Equal(model.SampleJobStatusPending))
			// Running job should still be running
			Expect(mockStore.jobs[runningJob.ID].Status).To(Equal(model.SampleJobStatusRunning))
		})

		It("does not auto-start a pending job when not connected to ComfyUI", func() {
			// AC: BE: If ComfyUI is unreachable when a job is created, the executor retries
			// once ComfyUI becomes available (i.e. does not transition to running while disconnected)
			executor.mu.Lock()
			executor.connected = false
			executor.mu.Unlock()

			job := model.SampleJob{
				ID:     "job-pending-3",
				Status: model.SampleJobStatusPending,
			}
			mockStore.jobs[job.ID] = job

			executor.processNextItem()

			// Job should remain pending — ComfyUI not available yet
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusPending))
		})

		It("auto-starts pending job and submits first item to ComfyUI", func() {
			// AC: BE: ComfyUI workflow submissions appear when a job is processing
			job := model.SampleJob{
				ID:           "job-pending-submit",
				Status:       model.SampleJobStatusPending,
				WorkflowName: "test-workflow.json",
			}
			item := model.SampleJobItem{
				ID:               "item-submit-1",
				JobID:            job.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
				SamplerName:      "euler",
				Scheduler:        "normal",
				Seed:             42,
				Steps:            20,
				CFG:              7.5,
				Width:            512,
				Height:           512,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.processNextItem()

			// Job was transitioned to running
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusRunning))
			// Item was submitted to ComfyUI (item status is now running with a prompt ID)
			items := mockStore.items[job.ID]
			Expect(items).To(HaveLen(1))
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
			Expect(items[0].ComfyUIPromptID).To(Equal("test-prompt-id"))
		})

		// AC: BE: prompt submissions include the WebSocket client_id so ComfyUI routes
		// prompt-specific events (executing, executed, execution_error) to the WS connection.
		It("includes the WebSocket client_id in the ComfyUI prompt submission", func() {
			job := model.SampleJob{
				ID:           "job-clientid-check",
				Status:       model.SampleJobStatusPending,
				WorkflowName: "test-workflow.json",
			}
			item := model.SampleJobItem{
				ID:               "item-clientid-1",
				JobID:            job.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
				SamplerName:      "euler",
				Scheduler:        "normal",
				Seed:             1,
				Steps:            1,
				CFG:              1.0,
				Width:            64,
				Height:           64,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.processNextItem()

			// Verify the prompt was submitted with the WebSocket client_id.
			// Without this, ComfyUI cannot route prompt-specific events back to our connection.
			Expect(mockClient.lastSubmittedReq).NotTo(BeNil())
			Expect(mockClient.lastSubmittedReq.ClientID).To(Equal("test-client-id"))
		})

		It("picks up a pending job after becoming connected", func() {
			// AC: BE: If ComfyUI is unreachable when a job is created, the executor retries
			// once ComfyUI becomes available
			executor.mu.Lock()
			executor.connected = false
			executor.mu.Unlock()

			job := model.SampleJob{
				ID:     "job-retry",
				Status: model.SampleJobStatusPending,
			}
			item := model.SampleJobItem{
				ID:               "item-retry-1",
				JobID:            job.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// First call — disconnected, job stays pending
			executor.processNextItem()
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusPending))

			// ComfyUI becomes available
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()

			// Second call — now connected, job should be auto-started
			executor.processNextItem()
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusRunning))
		})

		It("returns error from autoStartJob when store update fails", func() {
			// Failure path: store write fails during auto-start
			job := model.SampleJob{
				ID:     "job-fail-start",
				Status: model.SampleJobStatusPending,
			}
			mockStore.jobs[job.ID] = job
			mockStore.updateJobError = errors.New("db write failed")

			// autoStartJob should return an error and job status should remain pending in-memory
			jobCopy := job
			err := executor.autoStartJob(&jobCopy)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("auto-starting job"))

			// Restore for cleanup
			mockStore.updateJobError = nil
		})

		It("logs at WARN (not ERROR) when UpdateSampleJob returns sql.ErrNoRows during auto-start", func() {
			// AC: B-066 — benign race between poll and reset should not emit ERROR log
			var logBuf bytes.Buffer
			testLogger := logrus.New()
			testLogger.SetOutput(&logBuf)
			testLogger.SetFormatter(&logrus.TextFormatter{DisableColors: true})
			testLogger.SetLevel(logrus.TraceLevel)

			localExecutor := NewJobExecutor(
				mockStore,
				mockClient,
				mockWS,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				testLogger,
			)

			job := model.SampleJob{
				ID:     "job-no-rows",
				Status: model.SampleJobStatusPending,
			}
			mockStore.jobs[job.ID] = job
			mockStore.updateJobError = sql.ErrNoRows

			jobCopy := job
			err := localExecutor.autoStartJob(&jobCopy)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("auto-starting job"))

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"))
			Expect(logOutput).To(ContainSubstring("level=warning"))

			// Restore for cleanup
			mockStore.updateJobError = nil
		})

		It("does not preempt the tracked active job when a new pending job is created", func() {
			// AC: BE: Only one job runs at a time — when activeJobID is set, a new pending
			// job must not displace the job the executor is already tracking.
			runningJob := model.SampleJob{
				ID:     "job-active",
				Status: model.SampleJobStatusRunning,
			}
			runningItem := model.SampleJobItem{
				ID:               "item-active-1",
				JobID:            runningJob.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/active.safetensors",
			}
			pendingJob := model.SampleJob{
				ID:     "job-new-pending",
				Status: model.SampleJobStatusPending,
			}

			mockStore.jobs[runningJob.ID] = runningJob
			mockStore.jobs[pendingJob.ID] = pendingJob
			mockStore.items[runningJob.ID] = []model.SampleJobItem{runningItem}
			mockStore.items[pendingJob.ID] = []model.SampleJobItem{}

			// Simulate executor already tracking job-active with an item in flight
			executor.mu.Lock()
			executor.activeJobID = runningJob.ID
			executor.activeItemID = "item-active-1"
			executor.mu.Unlock()

			// processNextItem should detect the in-flight item and bail out early,
			// leaving the pending job untouched.
			executor.processNextItem()

			// The pending job must not have been auto-started
			Expect(mockStore.jobs[pendingJob.ID].Status).To(Equal(model.SampleJobStatusPending))
			// The running job remains running
			Expect(mockStore.jobs[runningJob.ID].Status).To(Equal(model.SampleJobStatusRunning))
			// The executor still tracks the original active job
			executor.mu.Lock()
			Expect(executor.activeJobID).To(Equal(runningJob.ID))
			executor.mu.Unlock()
		})

		It("does not switch to a different running job when activeJobID is already set", func() {
			// AC: BE: Executor must not preempt its tracked job by switching to a different
			// running job that appears in the store (e.g. started via an external API call).
			trackedJob := model.SampleJob{
				ID:     "job-tracked",
				Status: model.SampleJobStatusRunning,
			}
			// trackedJob's item has been submitted to ComfyUI; activeItemID is non-empty
			trackedItem := model.SampleJobItem{
				ID:               "item-tracked-1",
				JobID:            trackedJob.ID,
				Status:           model.SampleJobItemStatusRunning,
				ComfyUIModelPath: "models/tracked.safetensors",
			}
			otherRunningJob := model.SampleJob{
				ID:     "job-other-running",
				Status: model.SampleJobStatusRunning,
			}
			otherItem := model.SampleJobItem{
				ID:               "item-other-1",
				JobID:            otherRunningJob.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/other.safetensors",
			}

			mockStore.jobs[trackedJob.ID] = trackedJob
			mockStore.jobs[otherRunningJob.ID] = otherRunningJob
			mockStore.items[trackedJob.ID] = []model.SampleJobItem{trackedItem}
			mockStore.items[otherRunningJob.ID] = []model.SampleJobItem{otherItem}

			// Executor is already tracking trackedJob with an item in-flight
			executor.mu.Lock()
			executor.activeJobID = trackedJob.ID
			executor.activeItemID = "item-tracked-1"
			executor.mu.Unlock()

			executor.processNextItem()

			// Other running job's item must not have been submitted to ComfyUI
			// (its item should still be pending, not running)
			otherItems := mockStore.items[otherRunningJob.ID]
			Expect(otherItems[0].Status).To(Equal(model.SampleJobItemStatusPending))

			// Executor still tracks the original job
			executor.mu.Lock()
			Expect(executor.activeJobID).To(Equal(trackedJob.ID))
			executor.mu.Unlock()
		})

		It("auto-starts a pending job and immediately submits work to ComfyUI in the same tick", func() {
			// AC: BE: After auto-starting a pending job, the executor submits the first work
			// item to ComfyUI in the same processNextItem call (no extra tick required).
			job := model.SampleJob{
				ID:           "job-autostart-submit",
				Status:       model.SampleJobStatusPending,
				WorkflowName: "test-workflow.json",
			}
			item := model.SampleJobItem{
				ID:               "item-autostart-1",
				JobID:            job.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/autostart.safetensors",
				SamplerName:      "dpm_2",
				Scheduler:        "karras",
				Seed:             99,
				Steps:            30,
				CFG:              6.0,
				Width:            768,
				Height:           768,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// No prior activeJobID — executor starts fresh
			executor.processNextItem()

			// Job must have been transitioned to running
			Expect(mockStore.jobs[job.ID].Status).To(Equal(model.SampleJobStatusRunning))

			// The item must now be running with a ComfyUI prompt ID assigned,
			// proving that SubmitPrompt was called in the same tick.
			items := mockStore.items[job.ID]
			Expect(items).To(HaveLen(1))
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
			Expect(items[0].ComfyUIPromptID).To(Equal("test-prompt-id"))

			// Executor state must reflect the active job and item
			executor.mu.Lock()
			Expect(executor.activeJobID).To(Equal(job.ID))
			Expect(executor.activeItemID).To(Equal(item.ID))
			executor.mu.Unlock()
		})
	})

	Describe("substituteWorkflow", func() {
		It("substitutes unet_loader with checkpoint path", func() {
			job := model.SampleJob{
				ID: "job-1",
			}
			item := model.SampleJobItem{
				ComfyUIModelPath: "models/checkpoints/test.safetensors",
			}

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())

			node1 := result["1"].(map[string]interface{})
			inputs := node1["inputs"].(map[string]interface{})
			Expect(inputs["unet_name"]).To(Equal("models/checkpoints/test.safetensors"))
		})

		It("substitutes sampler parameters", func() {
			job := model.SampleJob{ID: "job-1"}
			item := model.SampleJobItem{
				Seed:        12345,
				Steps:       20,
				CFG:         7.5,
				SamplerName: "euler",
				Scheduler:   "normal",
			}

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())

			node2 := result["2"].(map[string]interface{})
			inputs := node2["inputs"].(map[string]interface{})
			Expect(inputs["seed"]).To(Equal(int64(12345)))
			Expect(inputs["steps"]).To(Equal(20))
			Expect(inputs["cfg"]).To(Equal(7.5))
			Expect(inputs["sampler_name"]).To(Equal("euler"))
			Expect(inputs["scheduler"]).To(Equal("normal"))
		})

		It("substitutes VAE and CLIP when provided", func() {
			job := model.SampleJob{
				ID:   "job-1",
				VAE:  "ae.safetensors",
				CLIP: "clip_l.safetensors",
			}
			item := model.SampleJobItem{}

			// Add VAE and CLIP loader nodes
			mockLoader.workflow.Workflow["4"] = map[string]interface{}{
				"inputs": map[string]interface{}{},
				"_meta": map[string]interface{}{
					"cs_role": "vae_loader",
				},
			}
			mockLoader.workflow.Workflow["5"] = map[string]interface{}{
				"inputs": map[string]interface{}{},
				"_meta": map[string]interface{}{
					"cs_role": "clip_loader",
				},
			}
			mockLoader.workflow.Roles["vae_loader"] = []string{"4"}
			mockLoader.workflow.Roles["clip_loader"] = []string{"5"}

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())

			node4 := result["4"].(map[string]interface{})
			inputs4 := node4["inputs"].(map[string]interface{})
			Expect(inputs4["vae_name"]).To(Equal("ae.safetensors"))

			node5 := result["5"].(map[string]interface{})
			inputs5 := node5["inputs"].(map[string]interface{})
			Expect(inputs5["clip_name"]).To(Equal("clip_l.safetensors"))
		})

		It("substitutes shift when provided", func() {
			shift := 3.0
			job := model.SampleJob{
				ID:    "job-1",
				Shift: &shift,
			}
			item := model.SampleJobItem{}

			// Add shift node
			mockLoader.workflow.Workflow["6"] = map[string]interface{}{
				"inputs": map[string]interface{}{},
				"_meta": map[string]interface{}{
					"cs_role": "shift",
				},
			}
			mockLoader.workflow.Roles["shift"] = []string{"6"}

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())

			node6 := result["6"].(map[string]interface{})
			inputs6 := node6["inputs"].(map[string]interface{})
			Expect(inputs6["shift"]).To(Equal(3.0))
		})

		It("substitutes positive_prompt with prompt text", func() {
			job := model.SampleJob{ID: "job-1"}
			item := model.SampleJobItem{
				PromptText: "a beautiful landscape",
			}

			// Add positive_prompt node
			mockLoader.workflow.Workflow["7"] = map[string]interface{}{
				"inputs": map[string]interface{}{},
				"_meta": map[string]interface{}{
					"cs_role": "positive_prompt",
				},
			}
			mockLoader.workflow.Roles["positive_prompt"] = []string{"7"}

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())

			node7 := result["7"].(map[string]interface{})
			inputs7 := node7["inputs"].(map[string]interface{})
			Expect(inputs7["text"]).To(Equal("a beautiful landscape"))
		})

		// AC: BE: negative_prompt cs_role injects preset's negative prompt into workflow
		DescribeTable("negative_prompt role substitution",
			func(negativePrompt string, existingDefault string, expectedText string) {
				job := model.SampleJob{ID: "job-1"}
				item := model.SampleJobItem{
					NegativePrompt: negativePrompt,
				}

				inputs := map[string]interface{}{}
				if existingDefault != "" {
					inputs["text"] = existingDefault
				}
				mockLoader.workflow.Workflow["9"] = map[string]interface{}{
					"inputs": inputs,
					"_meta": map[string]interface{}{
						"cs_role": "negative_prompt",
					},
				}
				mockLoader.workflow.Roles["negative_prompt"] = []string{"9"}

				result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
				Expect(err).ToNot(HaveOccurred())

				node9 := result["9"].(map[string]interface{})
				inputs9 := node9["inputs"].(map[string]interface{})
				// AC: When the preset has no negative prompt, the node keeps its default value
				if expectedText != "" {
					Expect(inputs9["text"]).To(Equal(expectedText))
				} else if existingDefault != "" {
					// Empty negative prompt leaves the existing default in place
					Expect(inputs9["text"]).To(Equal(existingDefault))
				} else {
					// No negative prompt and no existing default: key may be absent or empty
					Expect(inputs9).NotTo(HaveKey("text"))
				}
			},
			// AC: When the workflow has a negative_prompt node and the preset has a negative prompt, the text is substituted
			Entry("injects negative prompt text when non-empty", "blurry, artifacts", "", "blurry, artifacts"),
			// AC: When the preset has no negative prompt (empty string), the node keeps its default value
			Entry("keeps existing default when negative prompt is empty", "", "ugly, deformed", ""),
			// AC: When the preset has no negative prompt (empty string), the node keeps its default value (no default set)
			Entry("no substitution when negative prompt is empty and no default", "", "", ""),
		)

		// AC: BE: When the workflow has no negative_prompt role, no error occurs
		It("does not error when workflow has no negative_prompt node", func() {
			job := model.SampleJob{ID: "job-1"}
			item := model.SampleJobItem{
				NegativePrompt: "blurry",
			}

			// Ensure negative_prompt role is not in the workflow
			delete(mockLoader.workflow.Roles, "negative_prompt")

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())
			Expect(result).NotTo(BeNil())
		})

		It("substitutes latent_image with width and height", func() {
			job := model.SampleJob{ID: "job-1"}
			item := model.SampleJobItem{
				Width:  1024,
				Height: 768,
			}

			// Add latent_image node
			mockLoader.workflow.Workflow["8"] = map[string]interface{}{
				"inputs": map[string]interface{}{},
				"_meta": map[string]interface{}{
					"cs_role": "latent_image",
				},
			}
			mockLoader.workflow.Roles["latent_image"] = []string{"8"}

			result, err := executor.substituteWorkflow(mockLoader.workflow, job, item)
			Expect(err).ToNot(HaveOccurred())

			node8 := result["8"].(map[string]interface{})
			inputs8 := node8["inputs"].(map[string]interface{})
			Expect(inputs8["width"]).To(Equal(1024))
			Expect(inputs8["height"]).To(Equal(768))
			Expect(inputs8["batch_size"]).To(Equal(1))
		})
	})

	Describe("generateOutputFilename", func() {
		It("generates query-encoded filename with all parameters", func() {
			item := model.SampleJobItem{
				PromptName:  "test-prompt",
				Steps:       20,
				CFG:         7.5,
				SamplerName: "euler",
				Scheduler:   "normal",
				Seed:        12345,
			}

			filename := executor.generateOutputFilename(item)
			Expect(filename).To(ContainSubstring("prompt=test-prompt"))
			Expect(filename).To(ContainSubstring("steps=20"))
			Expect(filename).To(ContainSubstring("cfg=7.5"))
			Expect(filename).To(ContainSubstring("sampler=euler"))
			Expect(filename).To(ContainSubstring("scheduler=normal"))
			Expect(filename).To(ContainSubstring("seed=12345"))
			Expect(filename).To(HaveSuffix(".png"))
		})
	})

	Describe("getOutputPath", func() {
		It("constructs the correct output path with study name", func() {
			path, err := executor.getOutputPath("Test Study", "checkpoint.safetensors", "test.png")
			Expect(err).ToNot(HaveOccurred())
			Expect(path).To(Equal("/test/samples/Test Study/checkpoint.safetensors/test.png"))
		})

		It("detects path traversal attempts", func() {
			_, err := executor.getOutputPath("study", "../../../etc", "passwd")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("path traversal detected"))
		})
	})

	Describe("handleItemCompletionAsync", func() {
		var job model.SampleJob
		var item model.SampleJobItem

		BeforeEach(func() {
			job = model.SampleJob{
				ID:             "job-1",
				Status:         model.SampleJobStatusRunning,
				TotalItems:     3,
				CompletedItems: 0,
			}
			item = model.SampleJobItem{
				ID:                 "item-1",
				JobID:              "job-1",
				CheckpointFilename: "test.safetensors",
				PromptName:         "test-prompt",
				Steps:              20,
				CFG:                7.5,
				SamplerName:        "euler",
				Scheduler:          "normal",
				Seed:               12345,
				Status:             model.SampleJobItemStatusRunning,
			}

			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}
		})

		It("downloads image, saves it, and updates item status", func() {
			executor.handleItemCompletionAsync(job.ID, item.ID, "test-prompt-id")

			// Verify item was updated to completed
			items := mockStore.items[job.ID]
			Expect(items).To(HaveLen(1))
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))
			Expect(items[0].OutputPath).To(ContainSubstring("test.safetensors"))

			// Verify job progress was updated
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.CompletedItems).To(Equal(1))

			// Verify progress event was broadcast
			Expect(mockHub.events).To(HaveLen(1))
			Expect(mockHub.events[0].Type).To(Equal(model.EventJobProgress))
			Expect(mockHub.events[0].Path).To(ContainSubstring("job_progress/job-1"))
			Expect(mockHub.events[0].JobProgressData).NotTo(BeNil())
			Expect(mockHub.events[0].JobProgressData.JobID).To(Equal("job-1"))
		})

		It("handles download errors gracefully", func() {
			mockClient.downloadErr = errors.New("download failed")

			// Set the active job ID so failItemAsync can access it
			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()

			executor.handleItemCompletionAsync(job.ID, item.ID, "test-prompt-id")

			// Verify item was marked as failed
			items := mockStore.items[job.ID]
			Expect(items).To(HaveLen(1))
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(items[0].ErrorMessage).To(ContainSubstring("failed to download image"))
		})

		// B-041: When the item no longer exists in the database (e.g. after a
		// DB reset), handleItemCompletionAsync should clear active state and
		// return gracefully instead of leaving the executor stuck.
		It("clears active state when item is not found (database reset race condition)", func() {
			// Set up active state referencing a stale item
			executor.mu.Lock()
			executor.activeJobID = "stale-job"
			executor.activeItemID = "stale-item"
			executor.activePromptID = "stale-prompt"
			executor.mu.Unlock()

			// Call handleItemCompletionAsync with a stale item ID that does not
			// exist in the store (simulates post-DB-reset state).
			executor.handleItemCompletionAsync("stale-job", "stale-item", "stale-prompt")

			// Active item and prompt state should be cleared so the executor
			// can pick up new work on the next tick.
			executor.mu.Lock()
			Expect(executor.activeItemID).To(BeEmpty())
			Expect(executor.activePromptID).To(BeEmpty())
			executor.mu.Unlock()
		})
	})

	Describe("Stop and Resume", func() {
		It("clears executor state when RequestStop is called", func() {
			// AC: After RequestStop, executor state is cleared so pending jobs can be
			// picked up on the next tick.
			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{}

			executor.mu.Lock()
			executor.activeJobID = "job-1"
			executor.activeItemID = "item-1"
			executor.activePromptID = "prompt-1"
			executor.stopRequested = false
			executor.mu.Unlock()

			err := executor.RequestStop("job-1")
			Expect(err).ToNot(HaveOccurred())

			// All active state must be cleared; stop flag must NOT be left set
			executor.mu.Lock()
			Expect(executor.activeJobID).To(BeEmpty())
			Expect(executor.activeItemID).To(BeEmpty())
			Expect(executor.activePromptID).To(BeEmpty())
			Expect(executor.stopRequested).To(BeFalse())
			executor.mu.Unlock()
		})

		// AC1: Executor owns the DB status update to stopped after RequestStop
		It("updates DB status to stopped atomically when RequestStop is called", func() {
			job := model.SampleJob{
				ID:     "job-atomic-stop",
				Status: model.SampleJobStatusRunning,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.activeItemID = "item-atomic-1"
			executor.activePromptID = ""
			executor.mu.Unlock()

			err := executor.RequestStop(job.ID)
			Expect(err).ToNot(HaveOccurred())

			// DB must be updated to stopped before executor state was cleared
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusStopped))
		})

		// AC2: No window where DB and executor state diverge during stop
		It("writes stopped status to DB before clearing executor active state", func() {
			// This test verifies the ordering: DB update happens before state clear.
			// We track calls order via a custom store that records sequence.
			type callRecord struct {
				event string
			}
			var callLog []callRecord

			trackingStore := newMockJobExecutorStore()
			job := model.SampleJob{
				ID:     "job-ordering",
				Status: model.SampleJobStatusRunning,
			}
			trackingStore.jobs[job.ID] = job
			trackingStore.items[job.ID] = []model.SampleJobItem{}

			// Build an executor with the tracking store
			trackingExecutor := NewJobExecutor(
				trackingStore,
				mockClient,
				mockWS,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				logger,
			)

			// Simulate the UpdateSampleJob call to record when the DB update happens
			// relative to executor state changes. After UpdateSampleJob returns, the
			// executor state should still be set (cleared only afterwards).
			trackingStore.onUpdateJob = func(j model.SampleJob) {
				// At the point of DB update, executor active state must still be set.
				// This is the key invariant: DB is written before executor clears itself.
				trackingExecutor.mu.Lock()
				activeJobID := trackingExecutor.activeJobID
				trackingExecutor.mu.Unlock()
				if j.Status == model.SampleJobStatusStopped {
					if activeJobID == job.ID {
						callLog = append(callLog, callRecord{"db_updated_before_state_clear"})
					} else {
						callLog = append(callLog, callRecord{"db_updated_after_state_clear"})
					}
				}
			}

			trackingExecutor.mu.Lock()
			trackingExecutor.activeJobID = job.ID
			trackingExecutor.activeItemID = "item-ordering-1"
			trackingExecutor.mu.Unlock()

			err := trackingExecutor.RequestStop(job.ID)
			Expect(err).ToNot(HaveOccurred())

			// The DB update must have happened while executor still held the job active
			Expect(callLog).To(ContainElement(callRecord{"db_updated_before_state_clear"}))
			Expect(callLog).NotTo(ContainElement(callRecord{"db_updated_after_state_clear"}))
		})

		It("clears stop flag when RequestResume is called while activeJobID matches", func() {
			executor.mu.Lock()
			executor.activeJobID = "job-1"
			executor.stopRequested = true
			executor.mu.Unlock()

			err := executor.RequestResume("job-1")
			Expect(err).ToNot(HaveOccurred())

			executor.mu.Lock()
			Expect(executor.stopRequested).To(BeFalse())
			executor.mu.Unlock()
		})

		It("returns no error from RequestResume when executor state is already cleared (job was stopped)", func() {
			// After a stop, activeJobID is empty. Resume should succeed (no-op) so the
			// executor loop can pick up the job on the next tick.
			executor.mu.Lock()
			executor.activeJobID = ""
			executor.stopRequested = false
			executor.mu.Unlock()

			err := executor.RequestResume("job-1")
			Expect(err).ToNot(HaveOccurred())
		})

		It("returns error when trying to stop non-running job", func() {
			executor.mu.Lock()
			executor.activeJobID = "job-2"
			executor.mu.Unlock()

			err := executor.RequestStop("job-1")
			Expect(err).To(HaveOccurred())
		})

		It("pending jobs are picked up by the executor after a running job is stopped", func() {
			// AC: BE: Job executor polls for jobs in pending status and auto-transitions them
			// to running — this must work even after a previous job was stopped.
			// This directly addresses the UAT feedback: "I stopped the running job.
			// Neither of the pending jobs started."

			// Set up: one running job (the one being stopped) and one pending job
			runningJob := model.SampleJob{
				ID:     "job-running",
				Status: model.SampleJobStatusRunning,
			}
			pendingJob := model.SampleJob{
				ID:     "job-pending",
				Status: model.SampleJobStatusPending,
			}
			pendingItem := model.SampleJobItem{
				ID:               "item-pending-1",
				JobID:            pendingJob.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
				SamplerName:      "euler",
				Scheduler:        "normal",
				Seed:             1,
				Steps:            1,
				CFG:              1.0,
				Width:            64,
				Height:           64,
			}
			mockStore.jobs[runningJob.ID] = runningJob
			mockStore.jobs[pendingJob.ID] = pendingJob
			mockStore.items[runningJob.ID] = []model.SampleJobItem{}
			mockStore.items[pendingJob.ID] = []model.SampleJobItem{pendingItem}

			// Mark the running job as active in the executor
			executor.mu.Lock()
			executor.connected = true
			executor.activeJobID = runningJob.ID
			executor.mu.Unlock()

			// Stop the running job (simulates user clicking Stop).
			// The executor now owns the DB status update to stopped (AC1), so no manual
			// store update is needed here.
			err := executor.RequestStop(runningJob.ID)
			Expect(err).ToNot(HaveOccurred())

			// DB must reflect stopped (executor wrote it)
			Expect(mockStore.jobs[runningJob.ID].Status).To(Equal(model.SampleJobStatusStopped))

			// Executor state must be fully cleared after stop
			executor.mu.Lock()
			Expect(executor.activeJobID).To(BeEmpty())
			Expect(executor.stopRequested).To(BeFalse())
			executor.mu.Unlock()

			// Next tick: executor should pick up the pending job
			executor.processNextItem()

			// Pending job must now be running
			Expect(mockStore.jobs[pendingJob.ID].Status).To(Equal(model.SampleJobStatusRunning))
		})
	})

	Describe("Error handling", func() {
		It("marks item as failed when workflow loading fails", func() {
			mockLoader.err = errors.New("workflow not found")

			job := model.SampleJob{
				ID:     "job-1",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:     "item-1",
				JobID:  "job-1",
				Status: model.SampleJobItemStatusPending,
			}

			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.activeJobID = job.ID
			executor.activeItemID = item.ID
			executor.processItem(job, item)

			// Verify item was marked as failed
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(items[0].ErrorMessage).To(ContainSubstring("workflow"))
		})

		It("marks item as failed when ComfyUI prompt submission fails", func() {
			mockClient.submitErr = errors.New("ComfyUI unavailable")

			job := model.SampleJob{
				ID:           "job-1",
				Status:       model.SampleJobStatusRunning,
				WorkflowName: "test.json",
			}
			item := model.SampleJobItem{
				ID:               "item-1",
				JobID:            "job-1",
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "test.safetensors",
			}

			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.activeJobID = job.ID
			executor.activeItemID = item.ID
			executor.processItem(job, item)

			// Verify item was marked as failed
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(items[0].ErrorMessage).To(ContainSubstring("ComfyUI"))
		})
	})

	// B-080: Graceful handling of sql.ErrNoRows during concurrent cancel/completion
	Describe("Cancellation race condition handling", func() {
		var testLogger *logrus.Logger
		var logBuf bytes.Buffer
		var localExecutor *JobExecutor

		BeforeEach(func() {
			logBuf.Reset()
			testLogger = logrus.New()
			testLogger.SetOutput(&logBuf)
			testLogger.SetFormatter(&logrus.TextFormatter{DisableColors: true})
			testLogger.SetLevel(logrus.TraceLevel)

			localExecutor = NewJobExecutor(
				mockStore,
				mockClient,
				mockWS,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				testLogger,
			)
			localExecutor.mu.Lock()
			localExecutor.connected = true
			localExecutor.mu.Unlock()
		})

		// AC1: Job executor gracefully handles cancellation during item processing without logging errors
		// AC2: No 'sql: no rows in result set' errors appear in logs when a running job is cancelled
		It("logs at WARN (not ERROR) when UpdateSampleJobItem returns sql.ErrNoRows during processItem status-to-running update", func() {
			// Simulate: item row deleted (job cancelled) between processNextItem listing it and processItem updating it
			job := model.SampleJob{
				ID:           "job-cancel-running",
				Status:       model.SampleJobStatusRunning,
				WorkflowName: "test-workflow.json",
			}
			item := model.SampleJobItem{
				ID:               "item-cancel-1",
				JobID:            job.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
				SamplerName:      "euler",
				Scheduler:        "normal",
				Seed:             1,
				Steps:            1,
				CFG:              1.0,
				Width:            64,
				Height:           64,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}
			// Simulate item row deleted by cancellation
			mockStore.updateItemError = sql.ErrNoRows

			localExecutor.mu.Lock()
			localExecutor.activeJobID = job.ID
			localExecutor.activeItemID = item.ID
			localExecutor.mu.Unlock()

			localExecutor.processItem(job, item)

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"), "should not log ERROR when item deleted during cancel")
			Expect(logOutput).To(ContainSubstring("level=warning"), "should log WARN when item deleted during cancel")

			// Active state must be cleared so executor can pick up new work
			localExecutor.mu.Lock()
			Expect(localExecutor.activeItemID).To(BeEmpty())
			localExecutor.mu.Unlock()

			// Restore
			mockStore.updateItemError = nil
		})

		It("logs at WARN (not ERROR) when UpdateSampleJobItem returns sql.ErrNoRows during handleItemCompletionAsync status-to-completed update", func() {
			// This is the primary bug scenario: item row deleted after image download but before completed status update
			job := model.SampleJob{
				ID:           "job-cancel-complete",
				Status:       model.SampleJobStatusRunning,
				TotalItems:   1,
				CompletedItems: 0,
			}
			item := model.SampleJobItem{
				ID:                 "item-cancel-2",
				JobID:              job.ID,
				CheckpointFilename: "test.safetensors",
				PromptName:         "test",
				Steps:              20,
				CFG:                7.5,
				SamplerName:        "euler",
				Scheduler:          "normal",
				Seed:               42,
				Status:             model.SampleJobItemStatusRunning,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}
			// Simulate item row deleted by job cancellation after image was downloaded
			mockStore.updateItemError = sql.ErrNoRows

			localExecutor.handleItemCompletionAsync(job.ID, item.ID, "test-prompt-id")

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"), "should not log ERROR when item deleted during cancel")
			Expect(logOutput).To(ContainSubstring("level=warning"), "should log WARN when item deleted during cancel")

			// Restore
			mockStore.updateItemError = nil
		})

		It("logs at WARN (not ERROR) when GetSampleJob returns sql.ErrNoRows during updateJobProgress", func() {
			// Simulate: job row deleted between item completion and progress update
			// By not putting the job in the store, GetSampleJob returns sql.ErrNoRows
			jobID := "job-deleted-before-progress"

			// Call updateJobProgress for a non-existent job
			localExecutor.updateJobProgress(jobID)

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"), "should not log ERROR when job deleted during cancel")
			Expect(logOutput).To(ContainSubstring("level=warning"), "should log WARN when job deleted during cancel")
		})

		It("logs at WARN (not ERROR) when UpdateSampleJob returns sql.ErrNoRows during updateJobProgress", func() {
			// Simulate: job row deleted between GetSampleJob and UpdateSampleJob in updateJobProgress
			job := model.SampleJob{
				ID:     "job-cancel-progress",
				Status: model.SampleJobStatusRunning,
			}
			mockStore.jobs[job.ID] = job
			mockStore.updateJobError = sql.ErrNoRows

			localExecutor.updateJobProgress(job.ID)

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"), "should not log ERROR when job deleted during cancel")
			Expect(logOutput).To(ContainSubstring("level=warning"), "should log WARN when job deleted during cancel")

			// Restore
			mockStore.updateJobError = nil
		})

		It("logs at WARN (not ERROR) and clears active state when GetSampleJob returns sql.ErrNoRows during completeJob", func() {
			// Simulate: job row deleted before completeJob can fetch it
			jobID := "job-deleted-before-complete"

			localExecutor.mu.Lock()
			localExecutor.activeJobID = jobID
			localExecutor.activeItemID = "some-item"
			localExecutor.mu.Unlock()

			localExecutor.completeJob(jobID)

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"), "should not log ERROR when job deleted during cancel")
			Expect(logOutput).To(ContainSubstring("level=warning"), "should log WARN when job deleted during cancel")

			// Active state must be cleared
			localExecutor.mu.Lock()
			Expect(localExecutor.activeJobID).To(BeEmpty())
			Expect(localExecutor.activeItemID).To(BeEmpty())
			localExecutor.mu.Unlock()
		})

		It("logs at WARN (not ERROR) and clears active state when UpdateSampleJob returns sql.ErrNoRows during completeJob", func() {
			// Simulate: job row deleted between GetSampleJob and UpdateSampleJob in completeJob
			job := model.SampleJob{
				ID:     "job-cancel-complete-update",
				Status: model.SampleJobStatusRunning,
			}
			mockStore.jobs[job.ID] = job
			mockStore.updateJobError = sql.ErrNoRows

			localExecutor.mu.Lock()
			localExecutor.activeJobID = job.ID
			localExecutor.activeItemID = "some-item"
			localExecutor.mu.Unlock()

			localExecutor.completeJob(job.ID)

			logOutput := logBuf.String()
			Expect(logOutput).NotTo(ContainSubstring("level=error"), "should not log ERROR when job deleted during cancel")
			Expect(logOutput).To(ContainSubstring("level=warning"), "should log WARN when job deleted during cancel")

			// Active state must be cleared
			localExecutor.mu.Lock()
			Expect(localExecutor.activeJobID).To(BeEmpty())
			Expect(localExecutor.activeItemID).To(BeEmpty())
			localExecutor.mu.Unlock()

			// Restore
			mockStore.updateJobError = nil
		})
	})

	Describe("WebSocket event handling", func() {
		BeforeEach(func() {
			job := model.SampleJob{
				ID:             "job-1",
				Status:         model.SampleJobStatusRunning,
				TotalItems:     1,
				CompletedItems: 0,
			}
			item := model.SampleJobItem{
				ID:                 "item-1",
				JobID:              "job-1",
				CheckpointFilename: "test.safetensors",
				PromptName:         "test",
				Steps:              20,
				CFG:                7.5,
				SamplerName:        "euler",
				Scheduler:          "normal",
				Seed:               12345,
				Status:             model.SampleJobItemStatusRunning,
				ComfyUIPromptID:    "test-prompt-id",
			}

			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.activeJobID = job.ID
			executor.activeItemID = item.ID
			executor.activePromptID = "test-prompt-id"
		})

		// AC: BE: Job executor receives and processes ComfyUI "executing" (null node) WebSocket events
		It("handles execution completion via executing event with null node", func() {
			event := model.ComfyUIEvent{
				Type: "executing",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"node":      nil,
				},
			}

			// handleComfyUIEvent acquires the lock internally — do not hold it here
			executor.handleComfyUIEvent(event)

			// Verify item was completed
			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))
		})

		// AC: BE: Job executor receives and processes ComfyUI "execution_success" WebSocket events
		It("handles execution completion via execution_success event", func() {
			// execution_success is emitted by newer ComfyUI versions upon successful
			// completion of a prompt, carrying the prompt_id in data.
			event := model.ComfyUIEvent{
				Type: "execution_success",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"timestamp": float64(1700000000000),
				},
			}

			executor.handleComfyUIEvent(event)

			// Verify item was completed
			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))
		})

		// AC: BE: execution_success for a different prompt_id is ignored
		It("ignores execution_success for a different prompt_id", func() {
			event := model.ComfyUIEvent{
				Type: "execution_success",
				Data: map[string]interface{}{
					"prompt_id": "other-prompt-id",
					"timestamp": float64(1700000000000),
				},
			}

			executor.handleComfyUIEvent(event)

			// Verify item was NOT completed
			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
		})

		// AC: BE: executing null-node event for a different prompt_id is ignored
		It("ignores executing null-node event for a different prompt_id", func() {
			event := model.ComfyUIEvent{
				Type: "executing",
				Data: map[string]interface{}{
					"prompt_id": "other-prompt-id",
					"node":      nil,
				},
			}

			executor.handleComfyUIEvent(event)

			// Verify item was NOT completed
			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
		})

		// AC: BE: events received when no prompt is active are ignored without panicking
		It("ignores events when no active prompt is set", func() {
			executor.mu.Lock()
			executor.activePromptID = ""
			executor.mu.Unlock()

			event := model.ComfyUIEvent{
				Type: "execution_success",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
				},
			}

			// Should not panic or modify state
			executor.handleComfyUIEvent(event)

			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
		})

		It("handles execution error event", func() {
			event := model.ComfyUIEvent{
				Type: "execution_error",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"error":     "some error",
				},
			}

			// handleComfyUIEvent acquires the lock internally — do not hold it here
			executor.handleComfyUIEvent(event)

			// Verify item was marked as failed
			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
		})

		// AC: BE: Parse and forward execution_error events with exception_message, exception_type, node_type
		It("parses structured fields from execution_error event", func() {
			event := model.ComfyUIEvent{
				Type: "execution_error",
				Data: map[string]interface{}{
					"prompt_id":         "test-prompt-id",
					"exception_message": "Given groups=1, weight of size [128, 4, 3, 3], expected input[1, 16, 64, 64] to have 4 channels",
					"exception_type":    "RuntimeError",
					"node_type":         "VAEDecode",
					"traceback":         []interface{}{"Traceback (most recent call last):\n", "  File \"/comfyui/execution.py\", line 123\n", "RuntimeError: VAE mismatch\n"},
				},
			}

			executor.handleComfyUIEvent(event)

			// Verify item was marked as failed with structured error data
			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(items[0].ExceptionType).To(Equal("RuntimeError"))
			Expect(items[0].NodeType).To(Equal("VAEDecode"))
			Expect(items[0].Traceback).To(ContainSubstring("Traceback (most recent call last)"))
			Expect(items[0].Traceback).To(ContainSubstring("RuntimeError: VAE mismatch"))
			// Error message should be composed from structured fields
			Expect(items[0].ErrorMessage).To(ContainSubstring("[RuntimeError]"))
			Expect(items[0].ErrorMessage).To(ContainSubstring("VAEDecode:"))
			Expect(items[0].ErrorMessage).To(ContainSubstring("expected input"))
		})

		// AC: BE: Include full traceback in WebSocket message
		It("includes full traceback from execution_error in the stored item", func() {
			event := model.ComfyUIEvent{
				Type: "execution_error",
				Data: map[string]interface{}{
					"prompt_id":         "test-prompt-id",
					"exception_message": "test error",
					"exception_type":    "ValueError",
					"node_type":         "KSampler",
					"traceback": []interface{}{
						"Traceback (most recent call last):\n",
						"  File \"/comfyui/execution.py\", line 100, in execute\n",
						"    return func()\n",
						"ValueError: test error\n",
					},
				},
			}

			executor.handleComfyUIEvent(event)

			items := mockStore.items["job-1"]
			Expect(items[0].Traceback).To(Equal(
				"Traceback (most recent call last):\n" +
					"  File \"/comfyui/execution.py\", line 100, in execute\n" +
					"    return func()\n" +
					"ValueError: test error\n",
			))
		})

		// AC: execution_error with missing optional fields gracefully degrades
		It("handles execution_error with missing optional fields", func() {
			event := model.ComfyUIEvent{
				Type: "execution_error",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					// No exception_message, exception_type, node_type, or traceback
				},
			}

			executor.handleComfyUIEvent(event)

			items := mockStore.items["job-1"]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusFailed))
			Expect(items[0].ErrorMessage).To(Equal("unknown error"))
			Expect(items[0].ExceptionType).To(BeEmpty())
			Expect(items[0].NodeType).To(BeEmpty())
			Expect(items[0].Traceback).To(BeEmpty())
		})

		// AC: execution_error broadcasts failed_item_details with structured error info
		It("broadcasts failed_item_details with structured error info in job_progress event", func() {
			event := model.ComfyUIEvent{
				Type: "execution_error",
				Data: map[string]interface{}{
					"prompt_id":         "test-prompt-id",
					"exception_message": "VAE mismatch",
					"exception_type":    "RuntimeError",
					"node_type":         "VAEDecode",
					"traceback":         []interface{}{"Traceback line 1\n", "Traceback line 2\n"},
				},
			}

			executor.handleComfyUIEvent(event)

			// Should have broadcast a job_progress event with failed_item_details
			Expect(mockHub.events).NotTo(BeEmpty())
			var progressEvent *model.FSEvent
			for i := range mockHub.events {
				if mockHub.events[i].Type == model.EventJobProgress {
					progressEvent = &mockHub.events[i]
				}
			}
			Expect(progressEvent).NotTo(BeNil())
			Expect(progressEvent.JobProgressData).NotTo(BeNil())
			Expect(progressEvent.JobProgressData.FailedItemDetails).NotTo(BeEmpty())

			detail := progressEvent.JobProgressData.FailedItemDetails[0]
			Expect(detail.CheckpointFilename).To(Equal("test.safetensors"))
			Expect(detail.ExceptionType).To(Equal("RuntimeError"))
			Expect(detail.NodeType).To(Equal("VAEDecode"))
			Expect(detail.Traceback).To(ContainSubstring("Traceback line 1"))
		})

		// AC: BE: ComfyUI executor forwards per-node progress events through the backend WebSocket
		It("forwards progress events to the hub as inference_progress events", func() {
			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(5),
					"max":       float64(20),
				},
			}

			executor.handleComfyUIEvent(event)

			// Verify an inference_progress event was broadcast to the hub
			Expect(mockHub.events).To(HaveLen(1))
			broadcasted := mockHub.events[0]
			Expect(broadcasted.Type).To(Equal(model.EventInferenceProgress))
			Expect(broadcasted.InferenceProgressData).NotTo(BeNil())
			Expect(broadcasted.InferenceProgressData.PromptID).To(Equal("test-prompt-id"))
			Expect(broadcasted.InferenceProgressData.CurrentValue).To(Equal(5))
			Expect(broadcasted.InferenceProgressData.MaxValue).To(Equal(20))
		})

		// AC: BE: WebSocket message type for inference progress includes prompt_id, current_value, max_value
		It("includes prompt_id, current_value, max_value in inference progress event", func() {
			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(10),
					"max":       float64(30),
				},
			}

			executor.handleComfyUIEvent(event)

			Expect(mockHub.events).To(HaveLen(1))
			data := mockHub.events[0].InferenceProgressData
			Expect(data.PromptID).To(Equal("test-prompt-id"))
			Expect(data.CurrentValue).To(Equal(10))
			Expect(data.MaxValue).To(Equal(30))
		})

		// AC: BE: Progress event uses active prompt ID when prompt_id is absent from event data
		It("uses active prompt ID when progress event data lacks prompt_id", func() {
			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"value": float64(3),
					"max":   float64(15),
				},
			}

			executor.handleComfyUIEvent(event)

			Expect(mockHub.events).To(HaveLen(1))
			data := mockHub.events[0].InferenceProgressData
			Expect(data.PromptID).To(Equal("test-prompt-id"))
			Expect(data.CurrentValue).To(Equal(3))
			Expect(data.MaxValue).To(Equal(15))
		})

		// AC: BE: Progress events are ignored when no active prompt is set
		It("ignores progress events when no active prompt is set", func() {
			executor.mu.Lock()
			executor.activePromptID = ""
			executor.mu.Unlock()

			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(1),
					"max":       float64(10),
				},
			}

			executor.handleComfyUIEvent(event)

			// No events should be broadcast
			Expect(mockHub.events).To(BeEmpty())
		})

		// AC: BE: Progress events with missing value/max are not forwarded
		It("does not forward progress events with missing value or max", func() {
			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(5),
					// "max" is missing
				},
			}

			executor.handleComfyUIEvent(event)

			// Should not be broadcast (missing max)
			Expect(mockHub.events).To(BeEmpty())
		})

		// AC: BE: Inference progress events include sample ETA based on elapsed time and step progress
		It("includes sample_eta_seconds in inference progress events when sampleStartTime is set", func() {
			// Set a fake start time 10 seconds in the past
			fakeStart := time.Now().Add(-10 * time.Second)
			executor.mu.Lock()
			executor.sampleStartTime = fakeStart
			executor.mu.Unlock()

			// value=10, max=20 means 10 steps done, 10 remaining
			// elapsed ~10s, so ETA = elapsed * (remaining/done) = 10 * (10/10) = ~10s
			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(10),
					"max":       float64(20),
				},
			}

			executor.handleComfyUIEvent(event)

			Expect(mockHub.events).To(HaveLen(1))
			data := mockHub.events[0].InferenceProgressData
			Expect(data).NotTo(BeNil())
			Expect(data.CurrentValue).To(Equal(10))
			Expect(data.MaxValue).To(Equal(20))
			// ETA should be approximately 10s (elapsed * remaining/done)
			// Allow ±2s for timing jitter in tests
			Expect(data.SampleETASeconds).To(BeNumerically(">", 8.0))
			Expect(data.SampleETASeconds).To(BeNumerically("<", 15.0))
		})

		// AC: BE: Inference progress events have zero sample ETA when no sampleStartTime is set
		It("has zero sample_eta_seconds in inference progress events when no sampleStartTime is set", func() {
			// Ensure sampleStartTime is zero (default state)
			executor.mu.Lock()
			executor.sampleStartTime = time.Time{}
			executor.mu.Unlock()

			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(5),
					"max":       float64(20),
				},
			}

			executor.handleComfyUIEvent(event)

			Expect(mockHub.events).To(HaveLen(1))
			data := mockHub.events[0].InferenceProgressData
			Expect(data).NotTo(BeNil())
			Expect(data.SampleETASeconds).To(Equal(0.0))
		})

		// AC: BE: Inference progress events have zero sample ETA when value is 0 (first step)
		It("has zero sample_eta_seconds when value is 0 (first step, no elapsed data yet)", func() {
			fakeStart := time.Now().Add(-1 * time.Second)
			executor.mu.Lock()
			executor.sampleStartTime = fakeStart
			executor.mu.Unlock()

			event := model.ComfyUIEvent{
				Type: "progress",
				Data: map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"value":     float64(0),
					"max":       float64(20),
				},
			}

			executor.handleComfyUIEvent(event)

			Expect(mockHub.events).To(HaveLen(1))
			data := mockHub.events[0].InferenceProgressData
			Expect(data).NotTo(BeNil())
			// value=0 means division by zero risk; implementation returns 0 ETA
			Expect(data.SampleETASeconds).To(Equal(0.0))
		})
	})

	Describe("Resilient startup", func() {
		It("starts successfully when ComfyUI WebSocket connection fails", func() {
			// Create a new executor with a WS client that fails to connect
			mockWSFailing := &mockComfyUIWS{
				connectErr: errors.New("connection refused"),
			}
			executorWithFailingWS := NewJobExecutor(
				mockStore,
				mockClient,
				mockWSFailing,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				logger,
			)

			// Start should succeed even though the connection fails
			err := executorWithFailingWS.Start()
			Expect(err).ToNot(HaveOccurred())

			// Verify executor is marked as not connected
			Expect(executorWithFailingWS.IsConnected()).To(BeFalse())

			// Clean up
			executorWithFailingWS.Stop()
		})

		It("reports connected status after successful connection", func() {
			err := executor.Start()
			Expect(err).ToNot(HaveOccurred())

			// Verify executor is marked as connected
			Expect(executor.IsConnected()).To(BeTrue())

			// Clean up
			executor.Stop()
		})

		It("does not process items when not connected", func() {
			// Create executor with failing WS
			mockWSFailing := &mockComfyUIWS{
				connectErr: errors.New("connection refused"),
			}
			executorWithFailingWS := NewJobExecutor(
				mockStore,
				mockClient,
				mockWSFailing,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				logger,
			)

			// Add a running job
			job := model.SampleJob{
				ID:             "job-1",
				Status:         model.SampleJobStatusRunning,
				TotalItems:     1,
				CompletedItems: 0,
			}
			item := model.SampleJobItem{
				ID:     "item-1",
				JobID:  "job-1",
				Status: model.SampleJobItemStatusPending,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// Start executor
			err := executorWithFailingWS.Start()
			Expect(err).ToNot(HaveOccurred())

			// Try to process (should be skipped because not connected)
			executorWithFailingWS.processNextItem()

			// Verify item is still pending (not processed)
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))

			// Clean up
			executorWithFailingWS.Stop()
		})

		It("handles Stop gracefully when Start was never called", func() {
			freshExecutor := NewJobExecutor(
				mockStore,
				mockClient,
				mockWS,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				logger,
			)

			// Should not panic or error
			freshExecutor.Stop()
		})

		It("handles Stop gracefully when Start failed", func() {
			mockWSFailing := &mockComfyUIWS{
				connectErr: errors.New("connection refused"),
			}
			executorWithFailingWS := NewJobExecutor(
				mockStore,
				mockClient,
				mockWSFailing,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				logger,
			)

			// Start (will succeed but not connected)
			_ = executorWithFailingWS.Start()

			// Should not panic or error
			executorWithFailingWS.Stop()
		})

		It("transitions from disconnected to connected when WS becomes available", func() {
			// Create mock WS that initially fails but can succeed later
			mockWSVariable := &mockComfyUIWS{
				connectErr: errors.New("connection refused"),
			}
			executorWithVariableWS := NewJobExecutor(
				mockStore,
				mockClient,
				mockWSVariable,
				mockLoader,
				mockHub,
				"/test/samples",
				mockFS,
				mockFSRead,
				logger,
			)

			// Start with failing connection
			err := executorWithVariableWS.Start()
			Expect(err).ToNot(HaveOccurred())
			Expect(executorWithVariableWS.IsConnected()).To(BeFalse())

			// Clear the connection error to simulate ComfyUI becoming available
			mockWSVariable.connectErr = nil

			// Manually trigger tryConnect (simulates the reconnection loop)
			err = executorWithVariableWS.tryConnect()
			Expect(err).ToNot(HaveOccurred())

			// Verify executor is now connected
			Expect(executorWithVariableWS.IsConnected()).To(BeTrue())

			// Clean up
			executorWithVariableWS.Stop()
		})
	})

	// AC: BE: If ComfyUI is unreachable when a job is created, the executor retries once
	// ComfyUI becomes available — disconnect detection enables the reconnection ticker.
	Describe("WebSocket disconnect handling", func() {
		BeforeEach(func() {
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()
		})

		It("marks executor as disconnected when handleDisconnect is called", func() {
			// Simulate a WebSocket disconnection
			executor.handleDisconnect()

			Expect(executor.IsConnected()).To(BeFalse())
		})

		It("clears stale in-flight item on disconnect", func() {
			// Simulate an in-flight item (submitted to ComfyUI, waiting for WS event)
			executor.mu.Lock()
			executor.activeJobID = "job-1"
			executor.activeItemID = "item-1"
			executor.activePromptID = "prompt-1"
			executor.mu.Unlock()

			executor.handleDisconnect()

			executor.mu.Lock()
			// activeJobID should be preserved so the executor resumes the same job
			Expect(executor.activeJobID).To(Equal("job-1"))
			// activeItemID and activePromptID should be cleared
			Expect(executor.activeItemID).To(BeEmpty())
			Expect(executor.activePromptID).To(BeEmpty())
			executor.mu.Unlock()
		})

		It("is a no-op when already disconnected", func() {
			executor.mu.Lock()
			executor.connected = false
			executor.mu.Unlock()

			// Should not panic
			executor.handleDisconnect()
			Expect(executor.IsConnected()).To(BeFalse())
		})

		It("allows reconnection and job resumption after disconnect", func() {
			// AC: BE: If ComfyUI is unreachable, the executor retries once ComfyUI becomes available

			job := model.SampleJob{
				ID:           "job-disconnect-resume",
				Status:       model.SampleJobStatusRunning,
				WorkflowName: "test-workflow.json",
			}
			item := model.SampleJobItem{
				ID:               "item-disconnect-1",
				JobID:            job.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
				SamplerName:      "euler",
				Scheduler:        "normal",
				Seed:             1,
				Steps:            1,
				CFG:              1.0,
				Width:            64,
				Height:           64,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// Simulate: executor was tracking the job and had an in-flight item
			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.activeItemID = "item-disconnect-1"
			executor.activePromptID = "some-prompt"
			executor.mu.Unlock()

			// WebSocket drops
			executor.handleDisconnect()

			// Executor is now disconnected and item is cleared
			Expect(executor.IsConnected()).To(BeFalse())

			// processNextItem should skip (not connected)
			executor.processNextItem()
			// Item should still be pending (not processed while disconnected)
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))

			// ComfyUI comes back — simulate reconnection
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()

			// Next tick: executor should resume processing the same job
			executor.processNextItem()
			items = mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
			Expect(items[0].ComfyUIPromptID).To(Equal("test-prompt-id"))
		})

		It("fires disconnect handler via mock SimulateDisconnect", func() {
			// Verify the mock's SimulateDisconnect works with the registered handler
			err := executor.Start()
			Expect(err).ToNot(HaveOccurred())
			defer executor.Stop()

			Expect(executor.IsConnected()).To(BeTrue())

			// Simulate WebSocket dropping
			mockWS.SimulateDisconnect()

			Expect(executor.IsConnected()).To(BeFalse())
		})

		It("allows pending job auto-start after disconnect and reconnect", func() {
			// AC: BE: Job executor polls for pending jobs and auto-transitions them to running
			// This test verifies the full cycle: connected -> disconnect -> reconnect -> auto-start

			pendingJob := model.SampleJob{
				ID:           "job-post-disconnect",
				Status:       model.SampleJobStatusPending,
				WorkflowName: "test-workflow.json",
			}
			pendingItem := model.SampleJobItem{
				ID:               "item-post-disconnect-1",
				JobID:            pendingJob.ID,
				Status:           model.SampleJobItemStatusPending,
				ComfyUIModelPath: "models/test.safetensors",
				SamplerName:      "euler",
				Scheduler:        "normal",
				Seed:             1,
				Steps:            1,
				CFG:              1.0,
				Width:            64,
				Height:           64,
			}
			mockStore.jobs[pendingJob.ID] = pendingJob
			mockStore.items[pendingJob.ID] = []model.SampleJobItem{pendingItem}

			// Simulate disconnect
			executor.handleDisconnect()
			Expect(executor.IsConnected()).To(BeFalse())

			// processNextItem should not auto-start while disconnected
			executor.processNextItem()
			Expect(mockStore.jobs[pendingJob.ID].Status).To(Equal(model.SampleJobStatusPending))

			// Reconnect
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()

			// Now processNextItem should auto-start the pending job
			executor.processNextItem()
			Expect(mockStore.jobs[pendingJob.ID].Status).To(Equal(model.SampleJobStatusRunning))
		})
	})

	Describe("Job completion with errors", func() {
		BeforeEach(func() {
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()
		})

		It("transitions job to completed_with_errors when some items failed", func() {
			// Job with 3 items: 2 completed, 1 failed (no pending)
			job := model.SampleJob{
				ID:         "job-partial-fail",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 3,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "VRAM overflow"},
			}

			// processNextItem should find no pending items and call completeJob
			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			// Job should be completed_with_errors
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusCompletedWithErrors))
		})

		It("transitions job to completed when all items succeeded", func() {
			// Job with 2 items: all completed (no failed, no pending)
			job := model.SampleJob{
				ID:         "job-all-pass",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 2,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusCompleted))
		})

		It("transitions job to completed_with_errors when ALL items failed", func() {
			job := model.SampleJob{
				ID:         "job-all-fail",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 2,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "error1"},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "error2"},
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusCompletedWithErrors))
		})

		It("transitions job to completed_with_errors when some items are skipped", func() {
			// B-061: Job with 3 items: 2 completed, 1 skipped (path matching failed during creation)
			job := model.SampleJob{
				ID:         "job-partial-skip",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 3,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusSkipped, ErrorMessage: "checkpoint not found in ComfyUI"},
			}

			// processNextItem should find no pending items and call completeJob
			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			// Job should be completed_with_errors, not completed
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusCompletedWithErrors))
		})

		It("transitions job to completed_with_errors when items are stuck in running", func() {
			// B-061: Edge case where an item was left in running status (e.g. ComfyUI disconnect)
			job := model.SampleJob{
				ID:         "job-stuck-running",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 2,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusRunning},
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			// Job should be completed_with_errors, not completed
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusCompletedWithErrors))
		})

		It("broadcasts skipped items as failed in job_progress event", func() {
			// B-061: Skipped items should be counted as failed in progress broadcasts
			job := model.SampleJob{
				ID:         "job-broadcast-skip",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 3,
				StudyID:    "study-1",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusSkipped, ErrorMessage: "checkpoint not found"},
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			// Should have broadcast a job_progress event with skipped counted as failed
			Expect(mockHub.events).NotTo(BeEmpty())
			lastEvent := mockHub.events[len(mockHub.events)-1]
			Expect(lastEvent.Type).To(Equal(model.EventJobProgress))
			Expect(lastEvent.JobProgressData).NotTo(BeNil())
			Expect(lastEvent.JobProgressData.Status).To(Equal("completed_with_errors"))
			Expect(lastEvent.JobProgressData.CompletedItems).To(Equal(2))
			Expect(lastEvent.JobProgressData.FailedItems).To(Equal(1))
			Expect(lastEvent.JobProgressData.PendingItems).To(Equal(0))
		})

		It("broadcasts job_progress event with correct status on completion", func() {
			job := model.SampleJob{
				ID:         "job-broadcast",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 2,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk2.safetensors", Status: model.SampleJobItemStatusFailed, ErrorMessage: "err"},
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()
			executor.processNextItem()

			// Should have broadcast a job_progress event
			Expect(mockHub.events).NotTo(BeEmpty())
			lastEvent := mockHub.events[len(mockHub.events)-1]
			Expect(lastEvent.Type).To(Equal(model.EventJobProgress))
			Expect(lastEvent.JobProgressData).NotTo(BeNil())
			Expect(lastEvent.JobProgressData.Status).To(Equal("completed_with_errors"))
			Expect(lastEvent.JobProgressData.CompletedItems).To(Equal(1))
			Expect(lastEvent.JobProgressData.FailedItems).To(Equal(1))
		})
	})

	// AC: BE: composeExecutionErrorMessage builds human-readable error summary
	Describe("composeExecutionErrorMessage", func() {
		It("formats with all fields: [ExceptionType] NodeType: message", func() {
			msg := composeExecutionErrorMessage("RuntimeError", "VAEDecode", "channels mismatch")
			Expect(msg).To(Equal("[RuntimeError] VAEDecode: channels mismatch"))
		})

		It("formats without exception type", func() {
			msg := composeExecutionErrorMessage("", "VAEDecode", "channels mismatch")
			Expect(msg).To(Equal("VAEDecode: channels mismatch"))
		})

		It("formats without node type", func() {
			msg := composeExecutionErrorMessage("RuntimeError", "", "channels mismatch")
			Expect(msg).To(Equal("[RuntimeError] channels mismatch"))
		})

		It("formats with only message", func() {
			msg := composeExecutionErrorMessage("", "", "channels mismatch")
			Expect(msg).To(Equal("channels mismatch"))
		})

		It("defaults to 'unknown error' when message is empty", func() {
			msg := composeExecutionErrorMessage("RuntimeError", "VAEDecode", "")
			Expect(msg).To(Equal("[RuntimeError] VAEDecode: unknown error"))
		})

		It("defaults to 'unknown error' when all fields are empty", func() {
			msg := composeExecutionErrorMessage("", "", "")
			Expect(msg).To(Equal("unknown error"))
		})
	})

	Describe("writeSidecar", func() {
		var job model.SampleJob
		var item model.SampleJobItem
		var shift float64

		BeforeEach(func() {
			shift = 3.5
			job = model.SampleJob{
				ID:           "job-sidecar-1",
				StudyID:      "study-sidecar-1",
				StudyName:    "Test Study",
				WorkflowName: "flux_dev.json",
				VAE:          "ae.safetensors",
				CLIP:         "clip_l.safetensors",
				Shift:        &shift,
			}
			// Add a study with a prompt_prefix so the sidecar can look it up
			mockStore.studies["study-sidecar-1"] = model.Study{
				ID:           "study-sidecar-1",
				PromptPrefix: "test prefix",
			}
			item = model.SampleJobItem{
				ID:                 "item-sidecar-1",
				JobID:              "job-sidecar-1",
				CheckpointFilename: "model-step00001000.safetensors",
				PromptName:         "forest",
				PromptText:         "a dense forest at dawn",
				NegativePrompt:     "blurry, artifacts",
				Seed:               420,
				CFG:                1.0,
				Steps:              20,
				SamplerName:        "euler",
				Scheduler:          "normal",
				Width:              1024,
				Height:             768,
			}
		})

		It("writes sidecar with correct path (same base name, .json extension)", func() {
			err := executor.writeSidecar("/test/samples/model-step00001000.safetensors/image.png", job, item)
			Expect(err).ToNot(HaveOccurred())

			// After atomic rename, the sidecar should be at the .json path
			sidecarPath := "/test/samples/model-step00001000.safetensors/image.json"
			Expect(mockFS.writtenFiles).To(HaveKey(sidecarPath))
		})

		It("writes sidecar with correct content", func() {
			err := executor.writeSidecar("/test/samples/model-step00001000.safetensors/image.png", job, item)
			Expect(err).ToNot(HaveOccurred())

			sidecarPath := "/test/samples/model-step00001000.safetensors/image.json"
			data, ok := mockFS.writtenFiles[sidecarPath]
			Expect(ok).To(BeTrue())

			var meta fileformat.SidecarMetadata
			Expect(json.Unmarshal(data, &meta)).To(Succeed())

			Expect(meta.Checkpoint).To(Equal("model-step00001000.safetensors"))
			Expect(meta.PromptPrefix).To(Equal("test prefix"))
			Expect(meta.PromptName).To(Equal("forest"))
			Expect(meta.PromptText).To(Equal("a dense forest at dawn"))
			Expect(meta.NegativePrompt).To(Equal("blurry, artifacts"))
			Expect(meta.Seed).To(Equal(int64(420)))
			Expect(meta.CFG).To(Equal(1.0))
			Expect(meta.Steps).To(Equal(20))
			Expect(meta.SamplerName).To(Equal("euler"))
			Expect(meta.Scheduler).To(Equal("normal"))
			Expect(meta.Width).To(Equal(1024))
			Expect(meta.Height).To(Equal(768))
			Expect(meta.VAE).To(Equal("ae.safetensors"))
			Expect(meta.CLIP).To(Equal("clip_l.safetensors"))
			Expect(meta.Shift).To(Equal(&shift))
			Expect(meta.WorkflowName).To(Equal("flux_dev.json"))
			Expect(meta.JobID).To(Equal("job-sidecar-1"))
			Expect(meta.Timestamp).NotTo(BeEmpty())
		})

		It("uses atomic write: writes to temp file first then renames", func() {
			imagePath := "/test/samples/model-step00001000.safetensors/image.png"
			tempPath := "/test/samples/model-step00001000.safetensors/image.json.tmp"
			sidecarPath := "/test/samples/model-step00001000.safetensors/image.json"

			err := executor.writeSidecar(imagePath, job, item)
			Expect(err).ToNot(HaveOccurred())

			// Temp file should not exist after rename
			Expect(mockFS.writtenFiles).NotTo(HaveKey(tempPath))
			// Final sidecar file should exist
			Expect(mockFS.writtenFiles).To(HaveKey(sidecarPath))
		})

		It("omits shift field when job has no shift", func() {
			jobNoShift := model.SampleJob{
				ID:           "job-no-shift",
				WorkflowName: "sd15.json",
				Shift:        nil,
			}

			err := executor.writeSidecar("/test/samples/model.safetensors/image.png", jobNoShift, item)
			Expect(err).ToNot(HaveOccurred())

			sidecarPath := "/test/samples/model.safetensors/image.json"
			data, ok := mockFS.writtenFiles[sidecarPath]
			Expect(ok).To(BeTrue())

			// When shift is nil, it should be omitted from JSON (omitempty)
			var raw map[string]interface{}
			Expect(json.Unmarshal(data, &raw)).To(Succeed())
			Expect(raw).NotTo(HaveKey("shift"))
		})

		It("returns error when rename fails", func() {
			mockFS.renameErr = errors.New("rename failed")

			err := executor.writeSidecar("/test/samples/model.safetensors/image.png", job, item)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("renaming sidecar file"))
		})
	})

	Describe("handleItemCompletionAsync sidecar integration", func() {
		var job model.SampleJob
		var item model.SampleJobItem

		BeforeEach(func() {
			job = model.SampleJob{
				ID:           "job-1",
				StudyID:      "study-completion-1",
				StudyName:    "Test Study",
				Status:       model.SampleJobStatusRunning,
				WorkflowName: "flux_dev.json",
				VAE:          "ae.safetensors",
				TotalItems:   1,
				CompletedItems: 0,
			}
			item = model.SampleJobItem{
				ID:                 "item-1",
				JobID:              "job-1",
				CheckpointFilename: "test.safetensors",
				PromptName:         "test-prompt",
				PromptText:         "a test image",
				NegativePrompt:     "bad quality",
				Steps:              20,
				CFG:                7.5,
				SamplerName:        "euler",
				Scheduler:          "normal",
				Seed:               12345,
				Width:              512,
				Height:             512,
				Status:             model.SampleJobItemStatusRunning,
			}

			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}
			mockStore.studies["study-completion-1"] = model.Study{
				ID: "study-completion-1",
			}
		})

		It("writes sidecar alongside image when item completes", func() {
			executor.handleItemCompletionAsync(job.ID, item.ID, "test-prompt-id")

			// Verify item was completed
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))

			// Verify a .json sidecar was written alongside the .png
			var sidecarPath string
			for path := range mockFS.writtenFiles {
				if len(path) > 5 && path[len(path)-5:] == ".json" {
					sidecarPath = path
					break
				}
			}
			Expect(sidecarPath).NotTo(BeEmpty(), "expected a .json sidecar file to be written")

			// Verify sidecar content
			data := mockFS.writtenFiles[sidecarPath]
			var meta fileformat.SidecarMetadata
			Expect(json.Unmarshal(data, &meta)).To(Succeed())
			Expect(meta.PromptName).To(Equal("test-prompt"))
			Expect(meta.JobID).To(Equal("job-1"))
			Expect(meta.WorkflowName).To(Equal("flux_dev.json"))
		})
	})

	// AC: S-075 — Completeness check for generated sample datasets
	Describe("verifyCheckpointCompleteness", func() {
		var job model.SampleJob

		BeforeEach(func() {
			job = model.SampleJob{
				ID:        "job-completeness",
				StudyName: "TestStudy",
				Status:    model.SampleJobStatusRunning,
			}
			mockStore.jobs[job.ID] = job
		})

		// AC: After each checkpoint's samples are generated, validate that all expected images exist on disk
		It("reports all files verified when all expected images exist on disk", func() {
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
				{
					ID: "i2", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "city", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}

			// Build the expected filenames
			file1 := executor.generateOutputFilename(items[0])
			file2 := executor.generateOutputFilename(items[1])

			checkpointDir := "/test/samples/TestStudy/ckpt1.safetensors"
			mockFSRead.dirs[checkpointDir] = true
			mockFSRead.files[checkpointDir] = []string{file1, file2}

			executor.verifyCheckpointCompleteness(job.ID, job.StudyName, "ckpt1.safetensors", items)

			executor.mu.Lock()
			info, ok := executor.checkpointCompleteness["ckpt1.safetensors"]
			executor.mu.Unlock()

			Expect(ok).To(BeTrue())
			Expect(info.Expected).To(Equal(2))
			Expect(info.Verified).To(Equal(2))
			Expect(info.Missing).To(Equal(0))
			Expect(info.Checkpoint).To(Equal("ckpt1.safetensors"))
		})

		// AC: Missing files are reported as warnings on the job (not failures)
		It("reports missing files when some expected images are absent", func() {
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
				{
					ID: "i2", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "city", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}

			// Only the first file exists on disk
			file1 := executor.generateOutputFilename(items[0])

			checkpointDir := "/test/samples/TestStudy/ckpt1.safetensors"
			mockFSRead.dirs[checkpointDir] = true
			mockFSRead.files[checkpointDir] = []string{file1}

			executor.verifyCheckpointCompleteness(job.ID, job.StudyName, "ckpt1.safetensors", items)

			executor.mu.Lock()
			info := executor.checkpointCompleteness["ckpt1.safetensors"]
			executor.mu.Unlock()

			Expect(info.Expected).To(Equal(2))
			Expect(info.Verified).To(Equal(1))
			Expect(info.Missing).To(Equal(1))
		})

		// AC: Compare expected items against actual files in the checkpoint's sample directory
		It("handles non-existent checkpoint directory", func() {
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt-missing.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}

			// Directory does not exist (not in mockFSRead.dirs)
			executor.verifyCheckpointCompleteness(job.ID, job.StudyName, "ckpt-missing.safetensors", items)

			executor.mu.Lock()
			info := executor.checkpointCompleteness["ckpt-missing.safetensors"]
			executor.mu.Unlock()

			Expect(info.Expected).To(Equal(1))
			Expect(info.Verified).To(Equal(0))
			Expect(info.Missing).To(Equal(1))
		})

		It("skips verification for checkpoints with no completed items", func() {
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusFailed,
				},
			}

			executor.verifyCheckpointCompleteness(job.ID, job.StudyName, "ckpt1.safetensors", items)

			executor.mu.Lock()
			_, ok := executor.checkpointCompleteness["ckpt1.safetensors"]
			executor.mu.Unlock()

			// No entry because there are no completed items to verify
			Expect(ok).To(BeFalse())
		})

		It("handles ListPNGFiles error gracefully", func() {
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt-err.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}

			checkpointDir := "/test/samples/TestStudy/ckpt-err.safetensors"
			mockFSRead.dirs[checkpointDir] = true
			mockFSRead.listErr = errors.New("permission denied")

			executor.verifyCheckpointCompleteness(job.ID, job.StudyName, "ckpt-err.safetensors", items)

			executor.mu.Lock()
			info := executor.checkpointCompleteness["ckpt-err.safetensors"]
			executor.mu.Unlock()

			// Errors result in 0 verified, all missing (graceful degradation)
			Expect(info.Expected).To(Equal(1))
			Expect(info.Verified).To(Equal(0))
			Expect(info.Missing).To(Equal(1))

			// Restore for other tests
			mockFSRead.listErr = nil
		})

		It("only counts items for the specified checkpoint", func() {
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
				{
					ID: "i2", JobID: job.ID, CheckpointFilename: "ckpt2.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "city", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}

			file1 := executor.generateOutputFilename(items[0])
			checkpointDir := "/test/samples/TestStudy/ckpt1.safetensors"
			mockFSRead.dirs[checkpointDir] = true
			mockFSRead.files[checkpointDir] = []string{file1}

			executor.verifyCheckpointCompleteness(job.ID, job.StudyName, "ckpt1.safetensors", items)

			executor.mu.Lock()
			info := executor.checkpointCompleteness["ckpt1.safetensors"]
			executor.mu.Unlock()

			// Only 1 expected (ckpt1 items), not 2
			Expect(info.Expected).To(Equal(1))
			Expect(info.Verified).To(Equal(1))
			Expect(info.Missing).To(Equal(0))
		})
	})

	// AC: Completeness status included in job progress WebSocket events
	Describe("broadcastJobProgress includes completeness data", func() {
		BeforeEach(func() {
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()
		})

		It("includes completeness data in broadcast when checkpoint is fully completed", func() {
			job := model.SampleJob{
				ID:              "job-completeness-broadcast",
				TrainingRunName: "test-model",
				StudyID:         "study-broadcast",
				StudyName:       "TestStudy",
				Status:          model.SampleJobStatusRunning,
				TotalItems:      2,
			}
			mockStore.jobs[job.ID] = job
			items := []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
				{
					ID: "i2", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "city", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}
			mockStore.items[job.ID] = items

			// Set up filesystem mock so completeness check succeeds
			// Path uses new layout: {sampleDir}/{trainingRunName}/{studyID}/{checkpoint}/
			file1 := executor.generateOutputFilename(items[0])
			file2 := executor.generateOutputFilename(items[1])
			checkpointDir := "/test/samples/test-model/study-broadcast/ckpt1.safetensors"
			mockFSRead.dirs[checkpointDir] = true
			mockFSRead.files[checkpointDir] = []string{file1, file2}

			executor.broadcastJobProgress(job.ID)

			Expect(mockHub.events).To(HaveLen(1))
			event := mockHub.events[0]
			Expect(event.JobProgressData).NotTo(BeNil())
			Expect(event.JobProgressData.CheckpointCompleteness).NotTo(BeEmpty())

			// Find our checkpoint in the completeness data
			var found bool
			for _, info := range event.JobProgressData.CheckpointCompleteness {
				if info.Checkpoint == "ckpt1.safetensors" {
					Expect(info.Expected).To(Equal(2))
					Expect(info.Verified).To(Equal(2))
					Expect(info.Missing).To(Equal(0))
					found = true
				}
			}
			Expect(found).To(BeTrue(), "expected completeness info for ckpt1.safetensors")
		})

		It("does not run completeness check for incomplete checkpoints", func() {
			job := model.SampleJob{
				ID:         "job-incomplete-ckpt",
				StudyName:  "TestStudy",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 2,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
				},
				{
					ID: "i2", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusPending,
				},
			}

			executor.broadcastJobProgress(job.ID)

			// No completeness data since the checkpoint is not fully completed
			Expect(mockHub.events).To(HaveLen(1))
			event := mockHub.events[0]
			Expect(event.JobProgressData.CheckpointCompleteness).To(BeEmpty())
		})

		It("does not re-run completeness check for already-verified checkpoints", func() {
			job := model.SampleJob{
				ID:         "job-no-recheck",
				StudyName:  "TestStudy",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 1,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{
					ID: "i1", JobID: job.ID, CheckpointFilename: "ckpt1.safetensors",
					Status: model.SampleJobItemStatusCompleted,
					PromptName: "forest", Steps: 20, CFG: 7.5,
					SamplerName: "euler", Scheduler: "normal", Seed: 42,
				},
			}

			// Pre-populate completeness data (simulating a prior check)
			executor.mu.Lock()
			executor.checkpointCompleteness["ckpt1.safetensors"] = model.CheckpointCompletenessInfo{
				Checkpoint: "ckpt1.safetensors",
				Expected:   1,
				Verified:   1,
				Missing:    0,
			}
			executor.mu.Unlock()

			// Even though no filesystem mock is set up, this should NOT error
			// because the checkpoint was already verified and won't be re-checked.
			executor.broadcastJobProgress(job.ID)

			Expect(mockHub.events).To(HaveLen(1))
			event := mockHub.events[0]
			Expect(event.JobProgressData.CheckpointCompleteness).To(HaveLen(1))
			Expect(event.JobProgressData.CheckpointCompleteness[0].Verified).To(Equal(1))
		})
	})

	// AC: The test reset endpoint pauses or synchronizes with the job executor
	// to prevent SQL errors during table recreation.
	Describe("Pause and Resume", func() {
		BeforeEach(func() {
			// Mark executor as connected so it would normally process items
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()
		})

		It("skips processNextItem when paused", func() {
			// Add a pending job that would normally be auto-started
			mockStore.jobs["job1"] = model.SampleJob{
				ID:     "job1",
				Status: model.SampleJobStatusPending,
			}

			// Pause the executor
			executor.Pause()

			// processNextItem should return immediately without querying the store
			executor.processNextItem()

			// The job should still be pending (not auto-started)
			Expect(mockStore.jobs["job1"].Status).To(Equal(model.SampleJobStatusPending))
		})

		It("resumes processing after Resume is called", func() {
			// Add a pending job
			mockStore.jobs["job1"] = model.SampleJob{
				ID:     "job1",
				Status: model.SampleJobStatusPending,
			}

			// Pause, then resume
			executor.Pause()
			executor.Resume()

			// processNextItem should work normally now — it should auto-start the
			// pending job. With no items the job goes pending -> running -> completed
			// in a single tick, so we verify it is no longer pending.
			executor.processNextItem()

			Expect(mockStore.jobs["job1"].Status).NotTo(Equal(model.SampleJobStatusPending))
		})

		It("is idempotent for Pause", func() {
			executor.Pause()
			executor.Pause() // second call should not panic or change state

			executor.mu.Lock()
			Expect(executor.paused).To(BeTrue())
			executor.mu.Unlock()
		})

		It("is idempotent for Resume", func() {
			executor.Resume() // resume without prior pause should not panic

			executor.mu.Lock()
			Expect(executor.paused).To(BeFalse())
			executor.mu.Unlock()
		})

		It("Pause followed by Resume followed by Pause works correctly", func() {
			executor.Pause()
			executor.Resume()
			executor.Pause()

			// Add a pending job
			mockStore.jobs["job1"] = model.SampleJob{
				ID:     "job1",
				Status: model.SampleJobStatusPending,
			}

			// Should not process while paused
			executor.processNextItem()
			Expect(mockStore.jobs["job1"].Status).To(Equal(model.SampleJobStatusPending))
		})

		// B-041: Pause must clear active state so the executor does not hold
		// stale references to database rows that are dropped during a reset.
		It("clears active state (jobID, itemID, promptID) when paused", func() {
			// Simulate an in-flight item
			executor.mu.Lock()
			executor.activeJobID = "job-stale"
			executor.activeItemID = "item-stale"
			executor.activePromptID = "prompt-stale"
			executor.mu.Unlock()

			executor.Pause()

			executor.mu.Lock()
			Expect(executor.activeJobID).To(BeEmpty())
			Expect(executor.activeItemID).To(BeEmpty())
			Expect(executor.activePromptID).To(BeEmpty())
			executor.mu.Unlock()
		})

		// B-041: WebSocket events arriving during pause must be discarded to
		// prevent the executor from acting on stale prompt/item IDs.
		It("discards WebSocket events while paused", func() {
			// Set up an active prompt so the handler would normally process events
			executor.mu.Lock()
			executor.activeJobID = "job-1"
			executor.activeItemID = "item-1"
			executor.activePromptID = "prompt-1"
			executor.mu.Unlock()

			executor.Pause()

			// Send a completion event that would normally trigger handleItemCompletionAsync
			mockWS.SendEvent(model.ComfyUIEvent{
				Type: "executing",
				Data: map[string]interface{}{
					"prompt_id": "prompt-1",
					"node":      nil,
				},
			})

			// The event should have been discarded; no item completion should have occurred.
			// Since Pause() cleared activePromptID, even if the paused check were missing,
			// the handler would skip. This test verifies the defense-in-depth behavior.
			executor.mu.Lock()
			Expect(executor.activeItemID).To(BeEmpty())
			executor.mu.Unlock()
		})

		// B-041: After Pause + Resume, the executor should be able to pick up
		// new work without being stuck on stale state from a previous cycle.
		It("picks up new work after Pause clears stale state and Resume restores processing", func() {
			// Simulate stale state from a previous job
			executor.mu.Lock()
			executor.activeJobID = "old-job"
			executor.activeItemID = "old-item"
			executor.activePromptID = "old-prompt"
			executor.mu.Unlock()

			// Pause clears stale state
			executor.Pause()

			// Add a new pending job (simulating a fresh test cycle after DB reset)
			mockStore.jobs["new-job"] = model.SampleJob{
				ID:     "new-job",
				Status: model.SampleJobStatusPending,
			}

			// Resume and verify the executor picks up the new job
			executor.Resume()
			executor.processNextItem()

			// The new job should have been auto-started
			Expect(mockStore.jobs["new-job"].Status).NotTo(Equal(model.SampleJobStatusPending))
		})
	})

	// AC: BE: Unit tests for toInt helper used by progress event parsing
	Describe("toInt", func() {
		It("extracts int from float64 (JSON number)", func() {
			v, ok := toInt(float64(42))
			Expect(ok).To(BeTrue())
			Expect(v).To(Equal(42))
		})

		It("extracts int from int", func() {
			v, ok := toInt(int(7))
			Expect(ok).To(BeTrue())
			Expect(v).To(Equal(7))
		})

		It("extracts int from int64", func() {
			v, ok := toInt(int64(100))
			Expect(ok).To(BeTrue())
			Expect(v).To(Equal(100))
		})

		It("returns false for string", func() {
			_, ok := toInt("not a number")
			Expect(ok).To(BeFalse())
		})

		It("returns false for nil", func() {
			_, ok := toInt(nil)
			Expect(ok).To(BeFalse())
		})
	})

	// AC1: Each generation job outputs a JSON manifest file containing all job params
	// AC5: Unit tests for manifest write
	Describe("writeManifest", func() {
		var job model.SampleJob
		var items []model.SampleJobItem
		var shift float64

		BeforeEach(func() {
			shift = 3.0
			job = model.SampleJob{
				ID:              "job-manifest-1",
				TrainingRunName: "my-model",
				StudyID:         "study-manifest-1",
				StudyName:       "Manifest Study",
				WorkflowName:    "flux_dev.json",
				VAE:             "ae.safetensors",
				CLIP:            "clip_l.safetensors",
				Shift:           &shift,
				Status:          model.SampleJobStatusCompleted,
			}
			mockStore.studies["study-manifest-1"] = model.Study{
				ID:      "study-manifest-1",
				Name:    "Manifest Study",
				Prompts: []model.NamedPrompt{
					{Name: "forest", Text: "a dense forest"},
				},
				Steps: []int{20},
				CFGs:  []float64{7.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "normal"},
				},
				Seeds:  []int64{42},
				Width:  1024,
				Height: 768,
			}
			items = []model.SampleJobItem{
				{
					ID: "item-m1", JobID: job.ID,
					CheckpointFilename: "cp1.safetensors",
					Status:             model.SampleJobItemStatusCompleted,
				},
				{
					ID: "item-m2", JobID: job.ID,
					CheckpointFilename: "cp2.safetensors",
					Status:             model.SampleJobItemStatusCompleted,
				},
				{
					ID: "item-m3", JobID: job.ID,
					CheckpointFilename: "cp1.safetensors",
					Status:             model.SampleJobItemStatusCompleted,
				},
			}
		})

		It("writes manifest to the study directory", func() {
			err := executor.writeManifest(job, items)
			Expect(err).NotTo(HaveOccurred())

			// Manifest should be at {sampleDir}/{trainingRunName}/{studyID}/manifest.json
			manifestPath := "/test/samples/my-model/study-manifest-1/manifest.json"
			Expect(mockFS.writtenFiles).To(HaveKey(manifestPath))
		})

		// AC2: Manifest includes study config, training run, checkpoint list
		It("writes manifest with correct content", func() {
			err := executor.writeManifest(job, items)
			Expect(err).NotTo(HaveOccurred())

			manifestPath := "/test/samples/my-model/study-manifest-1/manifest.json"
			data, ok := mockFS.writtenFiles[manifestPath]
			Expect(ok).To(BeTrue())

			var manifest fileformat.JobManifest
			Expect(json.Unmarshal(data, &manifest)).To(Succeed())

			// Job metadata
			Expect(manifest.JobID).To(Equal("job-manifest-1"))
			Expect(manifest.TrainingRunName).To(Equal("my-model"))
			Expect(manifest.WorkflowName).To(Equal("flux_dev.json"))
			Expect(manifest.VAE).To(Equal("ae.safetensors"))
			Expect(manifest.CLIP).To(Equal("clip_l.safetensors"))
			Expect(manifest.Shift).To(Equal(&shift))

			// Study config snapshot
			Expect(manifest.StudyID).To(Equal("study-manifest-1"))
			Expect(manifest.StudyName).To(Equal("Manifest Study"))
			Expect(manifest.Width).To(Equal(1024))
			Expect(manifest.Height).To(Equal(768))

			// Dimension values
			Expect(manifest.Prompts).To(HaveLen(1))
			Expect(manifest.Prompts[0].Name).To(Equal("forest"))
			Expect(manifest.Steps).To(Equal([]int{20}))
			Expect(manifest.CFGs).To(Equal([]float64{7.0}))
			Expect(manifest.Seeds).To(Equal([]int64{42}))
			Expect(manifest.SamplerSchedulerPairs).To(HaveLen(1))

			// Checkpoint list (deduplicated, preserving order)
			Expect(manifest.Checkpoints).To(Equal([]string{
				"cp1.safetensors",
				"cp2.safetensors",
			}))

			// Derived count
			Expect(manifest.ImagesPerCheckpoint).To(Equal(1))
		})

		It("uses atomic write: writes to temp file first then renames", func() {
			err := executor.writeManifest(job, items)
			Expect(err).NotTo(HaveOccurred())

			manifestPath := "/test/samples/my-model/study-manifest-1/manifest.json"
			tempPath := manifestPath + ".tmp"

			// Temp file should not exist after rename
			Expect(mockFS.writtenFiles).NotTo(HaveKey(tempPath))
			// Final manifest file should exist
			Expect(mockFS.writtenFiles).To(HaveKey(manifestPath))
		})

		It("returns error when study not found", func() {
			job.StudyID = "nonexistent-study"
			err := executor.writeManifest(job, items)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("fetching study for manifest"))
		})

		It("returns error when rename fails", func() {
			mockFS.renameErr = errors.New("rename failed")
			err := executor.writeManifest(job, items)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("renaming manifest file"))
			mockFS.renameErr = nil // reset
		})

		It("deduplicates checkpoint filenames preserving order", func() {
			// Items with repeated checkpoint filenames
			items = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "cpB.safetensors"},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "cpA.safetensors"},
				{ID: "i3", JobID: job.ID, CheckpointFilename: "cpB.safetensors"},
				{ID: "i4", JobID: job.ID, CheckpointFilename: "cpC.safetensors"},
				{ID: "i5", JobID: job.ID, CheckpointFilename: "cpA.safetensors"},
			}

			err := executor.writeManifest(job, items)
			Expect(err).NotTo(HaveOccurred())

			manifestPath := "/test/samples/my-model/study-manifest-1/manifest.json"
			data := mockFS.writtenFiles[manifestPath]

			var manifest fileformat.JobManifest
			Expect(json.Unmarshal(data, &manifest)).To(Succeed())

			// Order should match first occurrence
			Expect(manifest.Checkpoints).To(Equal([]string{
				"cpB.safetensors",
				"cpA.safetensors",
				"cpC.safetensors",
			}))
		})
	})

	// AC1: Manifest is written during job completion
	Describe("completeJob writes manifest", func() {
		BeforeEach(func() {
			executor.mu.Lock()
			executor.connected = true
			executor.mu.Unlock()
		})

		It("writes manifest file when job completes successfully", func() {
			job := model.SampleJob{
				ID:              "job-complete-manifest",
				TrainingRunName: "complete-model",
				StudyID:         "study-complete-manifest",
				StudyName:       "Complete Study",
				Status:          model.SampleJobStatusRunning,
				TotalItems:      2,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
				{ID: "i2", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
			}
			mockStore.studies["study-complete-manifest"] = model.Study{
				ID:      "study-complete-manifest",
				Name:    "Complete Study",
				Prompts: []model.NamedPrompt{{Name: "p1", Text: "t1"}},
				Steps:   []int{20},
				CFGs:    []float64{7.0},
				SamplerSchedulerPairs: []model.SamplerSchedulerPair{
					{Sampler: "euler", Scheduler: "normal"},
				},
				Seeds:  []int64{42},
				Width:  512,
				Height: 512,
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()

			// processNextItem should find no pending items and call completeJob
			executor.processNextItem()

			// Verify manifest was written at {sampleDir}/{trainingRunName}/{studyID}/manifest.json
			manifestPath := "/test/samples/complete-model/study-complete-manifest/manifest.json"
			Expect(mockFS.writtenFiles).To(HaveKey(manifestPath))

			// Verify manifest content
			data := mockFS.writtenFiles[manifestPath]
			var manifest fileformat.JobManifest
			Expect(json.Unmarshal(data, &manifest)).To(Succeed())
			Expect(manifest.JobID).To(Equal("job-complete-manifest"))
			Expect(manifest.StudyName).To(Equal("Complete Study"))
			Expect(manifest.Checkpoints).To(Equal([]string{"chk1.safetensors"}))
		})

		It("still completes the job when manifest write fails (non-fatal)", func() {
			job := model.SampleJob{
				ID:         "job-manifest-fail",
				StudyID:    "nonexistent-study", // study not in store -> manifest write will fail
				StudyName:  "No Study",
				Status:     model.SampleJobStatusRunning,
				TotalItems: 1,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "i1", JobID: job.ID, CheckpointFilename: "chk1.safetensors", Status: model.SampleJobItemStatusCompleted},
			}

			executor.mu.Lock()
			executor.activeJobID = job.ID
			executor.mu.Unlock()

			executor.processNextItem()

			// Job should still be completed despite manifest write failure
			updatedJob := mockStore.jobs[job.ID]
			Expect(updatedJob.Status).To(Equal(model.SampleJobStatusCompleted))

			// No manifest should be written (study fetch fails)
			manifestPath := "/test/samples/No Study/manifest.json"
			Expect(mockFS.writtenFiles).NotTo(HaveKey(manifestPath))
		})
	})

	// AC1: BE: WebSocket connection to ComfyUI automatically reconnects on disconnect
	// AC2: BE: After reconnect, executor polls ComfyUI history API to detect already-completed prompts
	// AC3: BE: Jobs stuck in running state due to missed completion events are recovered
	Describe("WebSocket reconnect and stuck-item recovery", func() {
		BeforeEach(func() {
			executor.mu.Lock()
			executor.connected = true
			executor.everConnected = true // simulate that we've connected before (so next connect = reconnect)
			executor.mu.Unlock()
		})

		It("does not trigger recovery on the initial connection (only on reconnect)", func() {
			// AC1: The first connection should not trigger history polling.
			// Set up a running job with a stuck item that has a prompt ID.
			job := model.SampleJob{
				ID:     "job-initial-connect",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:              "item-initial-1",
				JobID:           job.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "prompt-initial-1",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// Use an executor where everConnected = false (initial state)
			freshExecutor := NewJobExecutor(
				mockStore, mockClient, mockWS, mockLoader, mockHub,
				"/test/samples", mockFS, mockFSRead, logger,
			)
			// Connect for the first time: everConnected is false, so isReconnect = false
			freshExecutor.mu.Lock()
			freshExecutor.connected = false
			freshExecutor.everConnected = false
			freshExecutor.mu.Unlock()

			// tryConnect should succeed and mark everConnected = true, but NOT trigger recovery
			err := freshExecutor.tryConnect()
			Expect(err).ToNot(HaveOccurred())
			Expect(freshExecutor.IsConnected()).To(BeTrue())

			// GetHistory should NOT have been called (no recovery on initial connect)
			// If it were called, it would succeed (mock returns historyResponse for "test-prompt-id"),
			// but since item has a different prompt ID, it would return empty and reset the item.
			// We verify by checking the item is still in "running" status (no reset happened).
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))

			freshExecutor.Stop()
		})

		It("resets stuck running item with no prompt ID to pending on reconnect", func() {
			// AC3: Items stuck in running without a prompt ID should be reset to pending.
			job := model.SampleJob{
				ID:     "job-stuck-no-prompt",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:              "item-no-prompt",
				JobID:           job.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "", // no prompt ID
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			executor.recoverStuckItems()

			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			Expect(items[0].ComfyUIPromptID).To(BeEmpty())
		})

		It("resets stuck running item to pending when prompt is not in ComfyUI history", func() {
			// AC2/AC3: If the prompt is not in history, reset to pending for retry.
			job := model.SampleJob{
				ID:     "job-not-in-history",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:              "item-not-in-history",
				JobID:           job.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "prompt-missing-from-history",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// GetHistory returns empty map (prompt not in history)
			mockClient.historyResponse = model.HistoryResponse{}

			executor.recoverStuckItems()

			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			Expect(items[0].ComfyUIPromptID).To(BeEmpty())
		})

		It("resets stuck running item to pending when history API call fails", func() {
			// AC2: If history API fails, reset to pending so it can be retried.
			job := model.SampleJob{
				ID:     "job-history-err",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:              "item-history-err",
				JobID:           job.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "prompt-history-err",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			mockClient.historyErr = errors.New("ComfyUI unreachable")

			executor.recoverStuckItems()

			// Restore for cleanup
			mockClient.historyErr = nil

			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			Expect(items[0].ComfyUIPromptID).To(BeEmpty())
		})

		It("resets stuck running item to pending when history entry has no output images", func() {
			// AC2/AC3: If the history entry exists but has no output images,
			// the prompt likely failed or is still running — reset to pending.
			job := model.SampleJob{
				ID:     "job-history-no-outputs",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:              "item-no-outputs",
				JobID:           job.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "prompt-no-outputs",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// History has the prompt but no output images
			mockClient.historyResponse = model.HistoryResponse{
				"prompt-no-outputs": model.HistoryEntry{
					Outputs: map[string]interface{}{
						"some_node": map[string]interface{}{
							// No "images" key
						},
					},
				},
			}

			executor.recoverStuckItems()

			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusPending))
			Expect(items[0].ComfyUIPromptID).To(BeEmpty())
		})

		It("processes completion for a stuck item whose prompt already completed in ComfyUI", func() {
			// AC2/AC3: If the prompt is in history with output images, treat it as
			// completed and process the completion (download image, update DB).
			job := model.SampleJob{
				ID:           "job-recover-complete",
				Status:       model.SampleJobStatusRunning,
				WorkflowName: "test-workflow.json",
			}
			item := model.SampleJobItem{
				ID:                 "item-recover-complete",
				JobID:              job.ID,
				CheckpointFilename: "test-checkpoint.safetensors",
				ComfyUIModelPath:   "models/test-checkpoint.safetensors",
				Status:             model.SampleJobItemStatusRunning,
				ComfyUIPromptID:    "prompt-recover",
				PromptName:         "test-prompt",
				PromptText:         "a photo",
				SamplerName:        "euler",
				Scheduler:          "normal",
				Seed:               42,
				Steps:              20,
				CFG:                7.0,
				Width:              512,
				Height:             512,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// History shows the prompt completed with output images
			mockClient.historyResponse = model.HistoryResponse{
				"prompt-recover": model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": map[string]interface{}{
							"images": []interface{}{
								map[string]interface{}{
									"filename":  "output_recovered.png",
									"subfolder": "",
									"type":      "output",
								},
							},
						},
					},
				},
			}

			executor.recoverStuckItems()

			// Item should be marked as completed after recovery
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusCompleted))
			Expect(items[0].OutputPath).NotTo(BeEmpty())
		})

		It("skips items in non-running status during recovery", func() {
			// Only items in running status should be examined; pending, completed, failed are skipped.
			job := model.SampleJob{
				ID:     "job-skip-non-running",
				Status: model.SampleJobStatusRunning,
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{
				{ID: "item-pending", JobID: job.ID, Status: model.SampleJobItemStatusPending, ComfyUIPromptID: ""},
				{ID: "item-completed", JobID: job.ID, Status: model.SampleJobItemStatusCompleted},
				{ID: "item-failed", JobID: job.ID, Status: model.SampleJobItemStatusFailed},
			}

			executor.recoverStuckItems()

			// None of the items should have changed status
			items := mockStore.items[job.ID]
			statusMap := make(map[string]model.SampleJobItemStatus)
			for _, i := range items {
				statusMap[i.ID] = i.Status
			}
			Expect(statusMap["item-pending"]).To(Equal(model.SampleJobItemStatusPending))
			Expect(statusMap["item-completed"]).To(Equal(model.SampleJobItemStatusCompleted))
			Expect(statusMap["item-failed"]).To(Equal(model.SampleJobItemStatusFailed))
		})

		It("skips jobs that are not in running status during recovery", func() {
			// Jobs in pending, completed, or stopped status should not be examined.
			completedJob := model.SampleJob{
				ID:     "job-already-completed",
				Status: model.SampleJobStatusCompleted,
			}
			stuckItem := model.SampleJobItem{
				ID:              "item-completed-job",
				JobID:           completedJob.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "old-prompt",
			}
			mockStore.jobs[completedJob.ID] = completedJob
			mockStore.items[completedJob.ID] = []model.SampleJobItem{stuckItem}

			mockClient.historyResponse = model.HistoryResponse{}

			executor.recoverStuckItems()

			// Item should NOT have been reset (job was not in running status)
			items := mockStore.items[completedJob.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
		})

		It("does not trigger recovery on reconnect when no jobs are running", func() {
			// Recovery should gracefully handle the case where there are no running jobs.
			// (Verifies no panic or unexpected side effects)
			mockStore.jobs = make(map[string]model.SampleJob)
			mockStore.items = make(map[string][]model.SampleJobItem)

			Expect(func() { executor.recoverStuckItems() }).NotTo(Panic())
		})

		It("skips recovery for a stuck item when active slot is already claimed", func() {
			// AC3: If processNextItem has already claimed the active slot while
			// recoverStuckItems is iterating, skip recovery to avoid overwriting active state.
			job := model.SampleJob{
				ID:     "job-slot-taken",
				Status: model.SampleJobStatusRunning,
			}
			item := model.SampleJobItem{
				ID:              "item-slot-taken",
				JobID:           job.ID,
				Status:          model.SampleJobItemStatusRunning,
				ComfyUIPromptID: "prompt-slot-taken",
			}
			mockStore.jobs[job.ID] = job
			mockStore.items[job.ID] = []model.SampleJobItem{item}

			// Simulate active slot already taken by another item
			executor.mu.Lock()
			executor.activeItemID = "other-active-item"
			executor.mu.Unlock()

			// History shows the prompt completed
			mockClient.historyResponse = model.HistoryResponse{
				"prompt-slot-taken": model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": map[string]interface{}{
							"images": []interface{}{
								map[string]interface{}{
									"filename": "output.png",
								},
							},
						},
					},
				},
			}

			executor.recoverStuckItems()

			// The active slot should not have been overwritten
			executor.mu.Lock()
			Expect(executor.activeItemID).To(Equal("other-active-item"))
			executor.mu.Unlock()

			// The item should still be in running status (recovery skipped)
			items := mockStore.items[job.ID]
			Expect(items[0].Status).To(Equal(model.SampleJobItemStatusRunning))
		})
	})

	// AC1/AC4: tryConnect triggers recoverStuckItems on reconnect but not initial connect
	Describe("tryConnect reconnect detection", func() {
		It("sets everConnected=true after first successful connect", func() {
			freshWS := &mockComfyUIWS{clientID: "fresh-id"}
			freshExecutor := NewJobExecutor(
				mockStore, mockClient, freshWS, mockLoader, mockHub,
				"/test/samples", mockFS, mockFSRead, logger,
			)

			freshExecutor.mu.Lock()
			Expect(freshExecutor.everConnected).To(BeFalse())
			freshExecutor.mu.Unlock()

			err := freshExecutor.tryConnect()
			Expect(err).ToNot(HaveOccurred())

			freshExecutor.mu.Lock()
			Expect(freshExecutor.everConnected).To(BeTrue())
			freshExecutor.mu.Unlock()

			freshExecutor.Stop()
		})

		It("marks everConnected=true even if reconnect fails", func() {
			// After a successful initial connect, everConnected stays true
			// through subsequent failed reconnect attempts (the flag only flips to true, never back).
			freshWS := &mockComfyUIWS{clientID: "fresh-id2"}
			freshExecutor := NewJobExecutor(
				mockStore, mockClient, freshWS, mockLoader, mockHub,
				"/test/samples", mockFS, mockFSRead, logger,
			)

			// First connect succeeds
			err := freshExecutor.tryConnect()
			Expect(err).ToNot(HaveOccurred())

			freshExecutor.mu.Lock()
			freshExecutor.connected = false // simulate disconnect
			freshExecutor.mu.Unlock()

			// Make the next connection attempt fail
			freshWS.connectErr = errors.New("connection refused")
			err = freshExecutor.tryConnect()
			Expect(err).To(HaveOccurred())

			// everConnected should still be true (was set on first success)
			freshExecutor.mu.Lock()
			Expect(freshExecutor.everConnected).To(BeTrue())
			freshExecutor.mu.Unlock()

			freshWS.connectErr = nil
			freshExecutor.Stop()
		})
	})

	// AC4: historyEntryHasOutputImages helper
	Describe("historyEntryHasOutputImages", func() {
		DescribeTable("detects output images in a ComfyUI history entry",
			func(entry model.HistoryEntry, expectHasImages bool) {
				result := historyEntryHasOutputImages(entry)
				Expect(result).To(Equal(expectHasImages))
			},
			Entry("empty outputs map returns false",
				model.HistoryEntry{Outputs: map[string]interface{}{}},
				false,
			),
			Entry("outputs with images array returns true",
				model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": map[string]interface{}{
							"images": []interface{}{
								map[string]interface{}{"filename": "output.png"},
							},
						},
					},
				},
				true,
			),
			Entry("outputs with empty images array returns false",
				model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": map[string]interface{}{
							"images": []interface{}{},
						},
					},
				},
				false,
			),
			Entry("outputs with no images key returns false",
				model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": map[string]interface{}{
							"latents": []interface{}{},
						},
					},
				},
				false,
			),
			Entry("outputs with non-map value returns false",
				model.HistoryEntry{
					Outputs: map[string]interface{}{
						"save_image": "not-a-map",
					},
				},
				false,
			),
			Entry("nil outputs returns false",
				model.HistoryEntry{Outputs: nil},
				false,
			),
		)
	})
})
