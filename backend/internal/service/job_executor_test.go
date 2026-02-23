package service

import (
	"context"
	"errors"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
)

// Mock implementations

type mockJobExecutorStore struct {
	jobs  map[string]model.SampleJob
	items map[string][]model.SampleJobItem
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
	handlers []model.ComfyUIEventHandler
}

func (m *mockComfyUIWS) AddHandler(handler model.ComfyUIEventHandler) {
	m.handlers = append(m.handlers, handler)
}

func (m *mockComfyUIWS) Connect(ctx context.Context) error {
	return nil
}

func (m *mockComfyUIWS) Close() error {
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

type mockFileSystemWriter struct{}

func (m *mockFileSystemWriter) MkdirAll(path string, perm uint32) error {
	return nil
}

func (m *mockFileSystemWriter) WriteFile(path string, data []byte, perm uint32) error {
	return nil
}

func (m *mockFileSystemWriter) Stat(path string) (fileInfo, error) {
	return mockFileInfo{isDir: true}, nil
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
		mockFS = &mockFileSystemWriter{}
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
})
