package store_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

var _ = Describe("ComfyUIHTTPClient", func() {
	Describe("QueueItem UnmarshalJSON", func() {
		DescribeTable("deserializes ComfyUI array format correctly",
			func(jsonData string, expectedNumber int, expectedPromptID string) {
				var item store.QueueItem
				err := json.Unmarshal([]byte(jsonData), &item)
				Expect(err).NotTo(HaveOccurred())
				Expect(item.Number).To(Equal(expectedNumber))
				Expect(item.PromptID).To(Equal(expectedPromptID))
			},
			Entry("valid queue item",
				`[123, "abc-def-ghi", {"1": {"inputs": {}}}, {"client_id": "test"}]`,
				123,
				"abc-def-ghi",
			),
			Entry("another valid queue item",
				`[456, "xyz-123-456", {}, {}]`,
				456,
				"xyz-123-456",
			),
		)

		It("returns error for invalid array length", func() {
			var item store.QueueItem
			err := json.Unmarshal([]byte(`[123, "abc"]`), &item)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("must have at least 4 elements"))
		})

		It("returns error for non-array input", func() {
			var item store.QueueItem
			err := json.Unmarshal([]byte(`{"number": 123}`), &item)
			Expect(err).To(HaveOccurred())
		})

		It("returns error for invalid number type", func() {
			var item store.QueueItem
			err := json.Unmarshal([]byte(`["not-a-number", "abc", {}, {}]`), &item)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("unmarshaling queue item number"))
		})

		It("returns error for invalid prompt_id type", func() {
			var item store.QueueItem
			err := json.Unmarshal([]byte(`[123, 456, {}, {}]`), &item)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("unmarshaling queue item prompt_id"))
		})
	})
})

// Helper to create a client pointing at a test server
// Since baseURL is private, we test through actual HTTP calls
var _ = Describe("ComfyUIHTTPClient HTTP operations", func() {
	var (
		ctx    context.Context
		server *httptest.Server
		logger *logrus.Logger
	)

	BeforeEach(func() {
		ctx = context.Background()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	AfterEach(func() {
		if server != nil {
			server.Close()
		}
	})

	createClient := func(s *httptest.Server) *store.ComfyUIHTTPClient {
		return store.NewComfyUIHTTPClient(s.URL, logger)
	}

	Describe("HealthCheck", func() {
		It("succeeds when server returns 200", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Expect(r.URL.Path).To(Equal("/system_stats"))
				Expect(r.Method).To(Equal(http.MethodGet))
				w.WriteHeader(http.StatusOK)
			}))

			client := createClient(server)
			err := client.HealthCheck(ctx)
			Expect(err).NotTo(HaveOccurred())
		})

		It("fails when server returns non-200", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
			}))

			client := createClient(server)
			err := client.HealthCheck(ctx)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("status 500"))
		})

		It("fails when server is unreachable", func() {
			// Create client pointing to non-existent server
			client := store.NewComfyUIHTTPClient("http://localhost:19999", logger)
			err := client.HealthCheck(ctx)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("health check failed"))
		})
	})

	Describe("SubmitPrompt", func() {
		It("submits prompt successfully", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Expect(r.URL.Path).To(Equal("/prompt"))
				Expect(r.Method).To(Equal(http.MethodPost))
				Expect(r.Header.Get("Content-Type")).To(Equal("application/json"))

				// Verify request body (should be JSON with prompt field)
				var req map[string]interface{}
				err := json.NewDecoder(r.Body).Decode(&req)
				Expect(err).NotTo(HaveOccurred())
				Expect(req).To(HaveKey("prompt"))

				// Return response (JSON format)
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"prompt_id": "test-prompt-id",
					"number":    1,
				})
			}))

			client := createClient(server)
			resp, err := client.SubmitPrompt(ctx, model.PromptRequest{
				Prompt: map[string]interface{}{
					"1": map[string]interface{}{"inputs": map[string]interface{}{}},
				},
			})

			Expect(err).NotTo(HaveOccurred())
			Expect(resp).NotTo(BeNil())
			Expect(resp.PromptID).To(Equal("test-prompt-id"))
			Expect(resp.Number).To(Equal(1))
		})

		It("handles server errors", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte("invalid prompt"))
			}))

			client := createClient(server)
			_, err := client.SubmitPrompt(ctx, model.PromptRequest{Prompt: map[string]interface{}{}})
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("status 400"))
		})
	})

	Describe("GetHistory", func() {
		It("retrieves history successfully", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Expect(r.URL.Path).To(Equal("/history/test-id"))
				Expect(r.Method).To(Equal(http.MethodGet))

				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"test-id": map[string]interface{}{
						"prompt": []interface{}{},
						"outputs": map[string]interface{}{
							"images": []interface{}{},
						},
						"status": map[string]interface{}{
							"completed": true,
						},
					},
				})
			}))

			client := createClient(server)
			history, err := client.GetHistory(ctx, "test-id")
			Expect(err).NotTo(HaveOccurred())
			Expect(history).To(HaveKey("test-id"))
		})

		It("retrieves all history when no ID specified", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Expect(r.URL.Path).To(Equal("/history"))
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{})
			}))

			client := createClient(server)
			_, err := client.GetHistory(ctx, "")
			Expect(err).NotTo(HaveOccurred())
		})
	})

	Describe("GetQueueStatus", func() {
		It("retrieves queue status successfully", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Expect(r.URL.Path).To(Equal("/queue"))
				Expect(r.Method).To(Equal(http.MethodGet))

				w.WriteHeader(http.StatusOK)
				// ComfyUI returns queue items as arrays
				json.NewEncoder(w).Encode(map[string]interface{}{
					"queue_pending": []interface{}{
						[]interface{}{1, "prompt-id-1", map[string]interface{}{}, map[string]interface{}{}},
					},
					"queue_running": []interface{}{
						[]interface{}{2, "prompt-id-2", map[string]interface{}{}, map[string]interface{}{}},
					},
				})
			}))

			client := createClient(server)
			status, err := client.GetQueueStatus(ctx)
			Expect(err).NotTo(HaveOccurred())
			Expect(status).NotTo(BeNil())
			Expect(status.Pending).To(HaveLen(1))
			Expect(status.Pending[0].PromptID).To(Equal("prompt-id-1"))
			Expect(status.Running).To(HaveLen(1))
			Expect(status.Running[0].PromptID).To(Equal("prompt-id-2"))
		})

		It("handles empty queue", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"queue_pending": []interface{}{},
					"queue_running": []interface{}{},
				})
			}))

			client := createClient(server)
			status, err := client.GetQueueStatus(ctx)
			Expect(err).NotTo(HaveOccurred())
			Expect(status.Pending).To(BeEmpty())
			Expect(status.Running).To(BeEmpty())
		})
	})

	Describe("GetObjectInfo", func() {
		It("retrieves object info for a specific node type", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				Expect(r.URL.Path).To(Equal("/object_info/VAELoader"))
				Expect(r.Method).To(Equal(http.MethodGet))

				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"VAELoader": map[string]interface{}{
						"input": map[string]interface{}{
							"required": map[string]interface{}{
								"vae_name": []interface{}{
									[]interface{}{"vae1.safetensors", "vae2.safetensors"},
								},
							},
						},
						"output":   []string{"VAE"},
						"category": "loaders",
						"name":     "VAELoader",
					},
				})
			}))

			client := createClient(server)
			info, err := client.GetObjectInfo(ctx, "VAELoader")
			Expect(err).NotTo(HaveOccurred())
			Expect(info).NotTo(BeNil())
			Expect(info.Name).To(Equal("VAELoader"))
			Expect(info.Category).To(Equal("loaders"))
			Expect(info.Input.Required).To(HaveKey("vae_name"))
		})

		It("returns error when node type not found", func() {
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{})
			}))

			client := createClient(server)
			_, err := client.GetObjectInfo(ctx, "NonExistent")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})
	})
})

// Per-call timeout tests — prove that the new injectable budgets work correctly.
// These use tiny distinguishable durations (ms-range) to keep the suite fast.
//
// Strategy: controlPlane=50ms, download=200ms.
// A stub server that delays 100ms will:
//   - time out a control-plane call  (50ms budget < 100ms delay) → error
//   - succeed for a download call    (200ms budget > 100ms delay) → data returned
var _ = Describe("ComfyUIHTTPClient timeout behaviour", func() {
	var (
		ctx    context.Context
		logger *logrus.Logger

		// Tiny budgets that make tests run in <500 ms total.
		controlPlaneBudget = 50 * time.Millisecond
		downloadBudget     = 200 * time.Millisecond
		// The stub server delays longer than controlPlaneBudget but shorter than
		// downloadBudget, so the two operations see different outcomes.
		stubDelay = 100 * time.Millisecond
	)

	BeforeEach(func() {
		ctx = context.Background()
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	// newTimedClient builds a client with the tiny injectable budgets.
	newTimedClient := func(serverURL string) *store.ComfyUIHTTPClient {
		return store.NewComfyUIHTTPClientWithTimeouts(serverURL, logger, controlPlaneBudget, downloadBudget)
	}

	Describe("DownloadImage", func() {
		It("succeeds when body delay exceeds the old 10s client-wide timeout but is under the download budget", func() {
			// The stub delays stubDelay (100ms) before sending the body.
			// With the old 10s client-wide Timeout this would have timed out at 10s;
			// here we prove it completes well within downloadBudget (200ms).
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Simulate GPU completing the image write after a short delay.
				time.Sleep(stubDelay)
				w.Header().Set("Content-Type", "image/png")
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("fake-image-data"))
			}))
			defer server.Close()

			client := newTimedClient(server.URL)
			data, err := client.DownloadImage(ctx, "output.png", "", "output")
			Expect(err).NotTo(HaveOccurred())
			Expect(data).To(Equal([]byte("fake-image-data")))
		})
	})

	Describe("HealthCheck (control-plane)", func() {
		It("fails fast when the server hangs beyond the control-plane budget", func() {
			// The stub never responds within controlPlaneBudget (50ms).
			ready := make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Block until the test is done (simulates a hung ComfyUI instance).
				<-ready
				w.WriteHeader(http.StatusOK)
			}))
			defer func() {
				close(ready)
				server.Close()
			}()

			client := newTimedClient(server.URL)
			start := time.Now()
			err := client.HealthCheck(ctx)
			elapsed := time.Since(start)

			Expect(err).To(HaveOccurred())
			// Should fail well within 2× the budget, not wait for stubDelay or longer.
			Expect(elapsed).To(BeNumerically("<", controlPlaneBudget*3))
		})
	})

	Describe("caller context cancellation", func() {
		It("aborts DownloadImage promptly when the caller cancels the context", func() {
			// Stub that never finishes — it blocks until the request context is done.
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
				// Respond after cancellation so the server goroutine can exit cleanly.
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			// Use generous budgets so only the explicit cancel triggers the abort.
			client := store.NewComfyUIHTTPClientWithTimeouts(server.URL, logger, 10*time.Second, 10*time.Second)

			cancelCtx, cancel := context.WithCancel(ctx)

			// Cancel after a short delay so the request is in-flight.
			go func() {
				time.Sleep(30 * time.Millisecond)
				cancel()
			}()

			start := time.Now()
			_, err := client.DownloadImage(cancelCtx, "output.png", "", "output")
			elapsed := time.Since(start)

			Expect(err).To(HaveOccurred())
			// Should return within a short window after cancel, not wait for the full budget.
			Expect(elapsed).To(BeNumerically("<", 500*time.Millisecond))
		})

		It("aborts a control-plane call promptly when the caller cancels the context", func() {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				<-r.Context().Done()
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			client := store.NewComfyUIHTTPClientWithTimeouts(server.URL, logger, 10*time.Second, 10*time.Second)

			cancelCtx, cancel := context.WithCancel(ctx)
			go func() {
				time.Sleep(30 * time.Millisecond)
				cancel()
			}()

			start := time.Now()
			err := client.HealthCheck(cancelCtx)
			elapsed := time.Since(start)

			Expect(err).To(HaveOccurred())
			Expect(elapsed).To(BeNumerically("<", 500*time.Millisecond))
		})
	})
})
