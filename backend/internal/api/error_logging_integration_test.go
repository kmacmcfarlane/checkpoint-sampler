package api_test

import (
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"
	goamiddleware "goa.design/goa/v3/middleware"
	goahttpmiddleware "goa.design/goa/v3/http/middleware"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("Error Logging Integration", func() {
	var (
		logger  *logrus.Logger
		hook    *test.Hook
		handler http.Handler
	)

	BeforeEach(func() {
		logger, hook = test.NewNullLogger()
	})

	Context("with full middleware stack", func() {
		It("logs 404 errors with request ID at warn level", func() {
			// Create a handler that returns 404
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"not found"}`))
			})

			// Apply middleware stack like in http.go (ErrorLoggingMiddleware wraps RequestID)
			handler = http.Handler(inner)
			handler = api.ErrorLoggingMiddleware(logger)(handler)
			handler = goahttpmiddleware.RequestID()(handler)

			req := httptest.NewRequest(http.MethodGet, "/api/test/123", nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusNotFound))

			// Verify error was logged
			var errorLogFound bool
			for _, entry := range hook.AllEntries() {
				if entry.Message == "HTTP client error" && entry.Level == logrus.WarnLevel {
					errorLogFound = true
					Expect(entry.Data).To(HaveKeyWithValue("method", "GET"))
					Expect(entry.Data).To(HaveKeyWithValue("path", "/api/test/123"))
					Expect(entry.Data).To(HaveKeyWithValue("status_code", 404))
					Expect(entry.Data).To(HaveKeyWithValue("error_message", "not found"))
					Expect(entry.Data).To(HaveKey("request_id"))
					Expect(entry.Data["request_id"]).NotTo(BeEmpty())
					break
				}
			}
			Expect(errorLogFound).To(BeTrue(), "Expected to find error log entry for 404")
		})

		It("logs 500 errors with request ID at error level", func() {
			// Create a handler that returns 500
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"internal error"}`))
			})

			// Apply middleware stack (ErrorLoggingMiddleware wraps RequestID)
			handler = http.Handler(inner)
			handler = api.ErrorLoggingMiddleware(logger)(handler)
			handler = goahttpmiddleware.RequestID()(handler)

			req := httptest.NewRequest(http.MethodPost, "/api/test", nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusInternalServerError))

			// Verify error was logged
			var errorLogFound bool
			for _, entry := range hook.AllEntries() {
				if entry.Message == "HTTP server error" && entry.Level == logrus.ErrorLevel {
					errorLogFound = true
					Expect(entry.Data).To(HaveKeyWithValue("method", "POST"))
					Expect(entry.Data).To(HaveKeyWithValue("path", "/api/test"))
					Expect(entry.Data).To(HaveKeyWithValue("status_code", 500))
					Expect(entry.Data).To(HaveKeyWithValue("error_message", "internal error"))
					Expect(entry.Data).To(HaveKey("request_id"))
					Expect(entry.Data["request_id"]).NotTo(BeEmpty())
					break
				}
			}
			Expect(errorLogFound).To(BeTrue(), "Expected to find error log entry for 500")
		})

		It("does not log 200 responses", func() {
			// Create a handler that returns 200
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{"status":"ok"}`))
			})

			// Apply middleware stack (ErrorLoggingMiddleware wraps RequestID)
			handler = http.Handler(inner)
			handler = api.ErrorLoggingMiddleware(logger)(handler)
			handler = goahttpmiddleware.RequestID()(handler)

			req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusOK))

			// Verify no error logs were generated
			for _, entry := range hook.AllEntries() {
				Expect(entry.Message).NotTo(Equal("HTTP client error"))
				Expect(entry.Message).NotTo(Equal("HTTP server error"))
			}
		})

		It("logs different HTTP methods correctly", func() {
			// Create a handler that returns 404
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
			})

			// Apply middleware stack (ErrorLoggingMiddleware wraps RequestID)
			handler = http.Handler(inner)
			handler = api.ErrorLoggingMiddleware(logger)(handler)
			handler = goahttpmiddleware.RequestID()(handler)

			methods := []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete, http.MethodPatch}
			for _, method := range methods {
				hook.Reset()

				req := httptest.NewRequest(method, "/api/test", nil)
				recorder := httptest.NewRecorder()

				handler.ServeHTTP(recorder, req)

				Expect(recorder.Code).To(Equal(http.StatusBadRequest))

				// Verify error was logged with correct method
				var errorLogFound bool
				for _, entry := range hook.AllEntries() {
					if entry.Message == "HTTP client error" {
						errorLogFound = true
						Expect(entry.Data).To(HaveKeyWithValue("method", method))
						break
					}
				}
				Expect(errorLogFound).To(BeTrue(), "Expected to find error log entry for "+method)
			}
		})

		It("uses the request ID from context when available", func() {
			// Create a handler that returns 404
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Verify the request ID is in context
				reqID := r.Context().Value(goamiddleware.RequestIDKey)
				Expect(reqID).NotTo(BeNil())

				w.WriteHeader(http.StatusNotFound)
			})

			// Apply middleware stack (ErrorLoggingMiddleware wraps RequestID)
			handler = http.Handler(inner)
			handler = api.ErrorLoggingMiddleware(logger)(handler)
			handler = goahttpmiddleware.RequestID()(handler)

			req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusNotFound))

			// Extract request ID from log entry
			var errorLogFound bool
			for _, entry := range hook.AllEntries() {
				if entry.Message == "HTTP client error" {
					errorLogFound = true
					Expect(entry.Data).To(HaveKey("request_id"))
					// Request ID should be populated by the middleware
					Expect(entry.Data["request_id"]).NotTo(BeEmpty())
					break
				}
			}

			Expect(errorLogFound).To(BeTrue(), "Expected to find error log entry")
		})

		It("logs all required fields for service errors", func() {
			// Create a handler that simulates a service error response
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusUnprocessableEntity)
				w.Write([]byte(`{"error":"validation failed"}`))
			})

			// Apply middleware stack (ErrorLoggingMiddleware wraps RequestID)
			handler = http.Handler(inner)
			handler = api.ErrorLoggingMiddleware(logger)(handler)
			handler = goahttpmiddleware.RequestID()(handler)

			req := httptest.NewRequest(http.MethodPost, "/api/presets", nil)
			recorder := httptest.NewRecorder()

			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusUnprocessableEntity))

			// Verify all required fields are logged
			var errorLogFound bool
			for _, entry := range hook.AllEntries() {
				if entry.Message == "HTTP client error" {
					errorLogFound = true
					Expect(entry.Data).To(HaveKey("request_id"))
					Expect(entry.Data["request_id"]).NotTo(BeEmpty())
					Expect(entry.Data).To(HaveKeyWithValue("method", "POST"))
					Expect(entry.Data).To(HaveKeyWithValue("path", "/api/presets"))
					Expect(entry.Data).To(HaveKeyWithValue("status_code", 422))
					Expect(entry.Data).To(HaveKeyWithValue("error_message", "validation failed"))
					Expect(entry.Level).To(Equal(logrus.WarnLevel))
					break
				}
			}
			Expect(errorLogFound).To(BeTrue(), "Expected to find error log entry")
		})
	})
})
