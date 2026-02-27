package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/fileformat"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
)

// Mock implementations

type mockJobExecutorStore struct {
	jobs            map[string]model.SampleJob
	items           map[string][]model.SampleJobItem
	updateJobError  error
}

func newMockJobExecutorStore() *mockJobExecutorStore {
	return &mockJobExecutorStore{
		jobs:  make(map[string]model.SampleJob),
		items: make(map[string][]model.SampleJobItem),
	}
}

func (m *mockJobExecutorStore) GetSampleJob(id string) (model.SampleJob, error) {
	job, ok := m.jobs[id]
	if !ok {
		return model.SampleJob{}, errors.New("not found")
	}
	return job, nil
}

func (m *mockJobExecutorStore) UpdateSampleJob(j model.SampleJob) error {
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

type mockComfyUIClient struct {
	submitErr       error
	promptResponse  *model.PromptResponse
	historyResponse model.HistoryResponse
	historyErr      error
	downloadData    []byte
	downloadErr     error
	cancelErr       error
}

func (m *mockComfyUIClient) SubmitPrompt(ctx context.Context, req model.PromptRequest) (*model.PromptResponse, error) {
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
	handlers   []model.ComfyUIEventHandler
	connectErr error
	closeErr   error
}

func (m *mockComfyUIWS) AddHandler(handler model.ComfyUIEventHandler) {
	m.handlers = append(m.handlers, handler)
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

func (m *mockComfyUIWS) SendEvent(event model.ComfyUIEvent) {
	for _, h := range m.handlers {
		h(event)
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

var _ = Describe("JobExecutor", func() {
	var (
		executor   *JobExecutor
		mockStore  *mockJobExecutorStore
		mockClient *mockComfyUIClient
		mockWS     *mockComfyUIWS
		mockLoader *mockWorkflowLoader
		mockHub    *mockEventHub
		mockFS     *mockFileSystemWriter
		logger     *logrus.Logger
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
		mockWS = &mockComfyUIWS{}
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
			// AC: BE: Only one job runs at a time; additional pending jobs wait in queue
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
		It("constructs the correct output path", func() {
			path, err := executor.getOutputPath("checkpoint.safetensors", "test.png")
			Expect(err).ToNot(HaveOccurred())
			Expect(path).To(Equal("/test/samples/checkpoint.safetensors/test.png"))
		})

		It("detects path traversal attempts", func() {
			_, err := executor.getOutputPath("../../../etc", "passwd")
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
			Expect(mockHub.events[0].Type).To(Equal(model.EventImageAdded))
			Expect(mockHub.events[0].Path).To(ContainSubstring("job_progress/job-1"))
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
	})

	Describe("Stop and Resume", func() {
		It("sets stop flag when RequestStop is called", func() {
			executor.activeJobID = "job-1"
			err := executor.RequestStop("job-1")
			Expect(err).ToNot(HaveOccurred())
			Expect(executor.stopRequested).To(BeTrue())
		})

		It("clears stop flag when RequestResume is called", func() {
			executor.activeJobID = "job-1"
			executor.stopRequested = true

			err := executor.RequestResume("job-1")
			Expect(err).ToNot(HaveOccurred())
			Expect(executor.stopRequested).To(BeFalse())
		})

		It("returns error when trying to stop non-running job", func() {
			executor.activeJobID = "job-2"
			err := executor.RequestStop("job-1")
			Expect(err).To(HaveOccurred())
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

		It("handles execution completion event", func() {
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

	Describe("writeSidecar", func() {
		var job model.SampleJob
		var item model.SampleJobItem
		var shift float64

		BeforeEach(func() {
			shift = 3.5
			job = model.SampleJob{
				ID:           "job-sidecar-1",
				WorkflowName: "flux_dev.json",
				VAE:          "ae.safetensors",
				CLIP:         "clip_l.safetensors",
				Shift:        &shift,
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
				ID:             "job-1",
				Status:         model.SampleJobStatusRunning,
				WorkflowName:   "flux_dev.json",
				VAE:            "ae.safetensors",
				TotalItems:     1,
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
})
