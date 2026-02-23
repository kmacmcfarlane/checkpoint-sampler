package api_test

import (
	"context"
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	"github.com/sirupsen/logrus/hooks/test"
	goamiddleware "goa.design/goa/v3/middleware"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("ErrorLoggingMiddleware", func() {
	var (
		logger   *logrus.Logger
		hook     *test.Hook
		handler  http.Handler
		recorder *httptest.ResponseRecorder
	)

	BeforeEach(func() {
		logger, hook = test.NewNullLogger()
		recorder = httptest.NewRecorder()
	})

	Context("when the handler returns a 2xx status", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
				w.Write([]byte("success"))
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("does not log anything", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(hook.AllEntries()).To(BeEmpty())
		})
	})

	Context("when the handler returns a 3xx status", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusFound)
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("does not log anything", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusFound))
			Expect(hook.AllEntries()).To(BeEmpty())
		})
	})

	Context("when the handler returns a 4xx status", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte("not found"))
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("logs at warn level with request details", func() {
			req := httptest.NewRequest(http.MethodGet, "/api/test/123", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusNotFound))
			Expect(hook.AllEntries()).To(HaveLen(1))

			entry := hook.LastEntry()
			Expect(entry.Level).To(Equal(logrus.WarnLevel))
			Expect(entry.Message).To(Equal("HTTP client error"))
			Expect(entry.Data).To(HaveKeyWithValue("method", "GET"))
			Expect(entry.Data).To(HaveKeyWithValue("path", "/api/test/123"))
			Expect(entry.Data).To(HaveKeyWithValue("status_code", 404))
		})
	})

	Context("when the handler returns a 5xx status", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("internal error"))
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("logs at error level with request details", func() {
			req := httptest.NewRequest(http.MethodPost, "/api/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusInternalServerError))
			Expect(hook.AllEntries()).To(HaveLen(1))

			entry := hook.LastEntry()
			Expect(entry.Level).To(Equal(logrus.ErrorLevel))
			Expect(entry.Message).To(Equal("HTTP server error"))
			Expect(entry.Data).To(HaveKeyWithValue("method", "POST"))
			Expect(entry.Data).To(HaveKeyWithValue("path", "/api/test"))
			Expect(entry.Data).To(HaveKeyWithValue("status_code", 500))
		})
	})

	Context("when the handler returns a 503 status", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusServiceUnavailable)
				w.Write([]byte("service unavailable"))
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("logs at error level", func() {
			req := httptest.NewRequest(http.MethodGet, "/api/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusServiceUnavailable))
			Expect(hook.AllEntries()).To(HaveLen(1))

			entry := hook.LastEntry()
			Expect(entry.Level).To(Equal(logrus.ErrorLevel))
			Expect(entry.Message).To(Equal("HTTP server error"))
			Expect(entry.Data).To(HaveKeyWithValue("status_code", 503))
		})
	})

	Context("when the handler returns multiple 4xx errors in sequence", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/bad-request" {
					w.WriteHeader(http.StatusBadRequest)
				} else if r.URL.Path == "/unauthorized" {
					w.WriteHeader(http.StatusUnauthorized)
				} else {
					w.WriteHeader(http.StatusForbidden)
				}
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("logs each error separately with correct status codes", func() {
			req1 := httptest.NewRequest(http.MethodGet, "/bad-request", nil)
			rec1 := httptest.NewRecorder()
			handler.ServeHTTP(rec1, req1)

			req2 := httptest.NewRequest(http.MethodGet, "/unauthorized", nil)
			rec2 := httptest.NewRecorder()
			handler.ServeHTTP(rec2, req2)

			req3 := httptest.NewRequest(http.MethodGet, "/forbidden", nil)
			rec3 := httptest.NewRecorder()
			handler.ServeHTTP(rec3, req3)

			Expect(hook.AllEntries()).To(HaveLen(3))
			Expect(hook.AllEntries()[0].Data["status_code"]).To(Equal(400))
			Expect(hook.AllEntries()[1].Data["status_code"]).To(Equal(401))
			Expect(hook.AllEntries()[2].Data["status_code"]).To(Equal(403))
		})
	})

	Context("when request ID is present in context", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusNotFound)
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("includes request ID in the log entry", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			ctx := context.WithValue(req.Context(), goamiddleware.RequestIDKey, "req-12345")
			req = req.WithContext(ctx)

			handler.ServeHTTP(recorder, req)

			Expect(hook.AllEntries()).To(HaveLen(1))
			entry := hook.LastEntry()
			Expect(entry.Data).To(HaveKeyWithValue("request_id", "req-12345"))
		})
	})

	Context("when request ID is not present in context", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("includes empty request ID in the log entry", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(hook.AllEntries()).To(HaveLen(1))
			entry := hook.LastEntry()
			Expect(entry.Data).To(HaveKey("request_id"))
			Expect(entry.Data["request_id"]).To(Equal(""))
		})
	})

	Context("when the handler does not explicitly call WriteHeader", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// Implicit 200 OK
				w.Write([]byte("ok"))
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		It("does not log anything", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(hook.AllEntries()).To(BeEmpty())
		})
	})

	Context("with different HTTP methods", func() {
		BeforeEach(func() {
			inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusBadRequest)
			})
			handler = api.ErrorLoggingMiddleware(logger)(inner)
		})

		DescribeTable("logs the correct HTTP method",
			func(method string) {
				req := httptest.NewRequest(method, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				Expect(entry.Data).To(HaveKeyWithValue("method", method))
			},
			Entry("GET", http.MethodGet),
			Entry("POST", http.MethodPost),
			Entry("PUT", http.MethodPut),
			Entry("DELETE", http.MethodDelete),
			Entry("PATCH", http.MethodPatch),
		)
	})

	Context("error message extraction from response body", func() {
		Context("with JSON error response containing 'message' field", func() {
			BeforeEach(func() {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusBadRequest)
					w.Write([]byte(`{"message":"validation error: field required"}`))
				})
				handler = api.ErrorLoggingMiddleware(logger)(inner)
			})

			It("extracts and logs the message field", func() {
				req := httptest.NewRequest(http.MethodPost, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				Expect(entry.Data).To(HaveKeyWithValue("error_message", "validation error: field required"))
			})
		})

		Context("with JSON error response containing 'error' field", func() {
			BeforeEach(func() {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte(`{"error":"database connection failed"}`))
				})
				handler = api.ErrorLoggingMiddleware(logger)(inner)
			})

			It("extracts and logs the error field", func() {
				req := httptest.NewRequest(http.MethodGet, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				Expect(entry.Data).To(HaveKeyWithValue("error_message", "database connection failed"))
			})
		})

		Context("with JSON response containing both 'message' and 'error' fields", func() {
			BeforeEach(func() {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusBadRequest)
					w.Write([]byte(`{"message":"primary message","error":"secondary error"}`))
				})
				handler = api.ErrorLoggingMiddleware(logger)(inner)
			})

			It("prefers the message field over error field", func() {
				req := httptest.NewRequest(http.MethodPost, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				Expect(entry.Data).To(HaveKeyWithValue("error_message", "primary message"))
			})
		})

		Context("with non-JSON error response", func() {
			BeforeEach(func() {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusInternalServerError)
					w.Write([]byte("Internal Server Error"))
				})
				handler = api.ErrorLoggingMiddleware(logger)(inner)
			})

			It("logs the raw body as error_message", func() {
				req := httptest.NewRequest(http.MethodGet, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				Expect(entry.Data).To(HaveKeyWithValue("error_message", "Internal Server Error"))
			})
		})

		Context("with large non-JSON error response", func() {
			BeforeEach(func() {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusInternalServerError)
					// Write a large body (more than 200 characters)
					largeBody := ""
					for i := 0; i < 30; i++ {
						largeBody += "error text "
					}
					w.Write([]byte(largeBody))
				})
				handler = api.ErrorLoggingMiddleware(logger)(inner)
			})

			It("truncates the body to 200 characters", func() {
				req := httptest.NewRequest(http.MethodGet, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				msg, ok := entry.Data["error_message"].(string)
				Expect(ok).To(BeTrue())
				Expect(msg).To(HaveSuffix("..."))
				Expect(len(msg)).To(Equal(203)) // 200 + "..."
			})
		})

		Context("with empty error response body", func() {
			BeforeEach(func() {
				inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.WriteHeader(http.StatusNotFound)
					// No body written
				})
				handler = api.ErrorLoggingMiddleware(logger)(inner)
			})

			It("does not include error_message field", func() {
				req := httptest.NewRequest(http.MethodGet, "/test", nil)
				handler.ServeHTTP(recorder, req)

				Expect(hook.AllEntries()).To(HaveLen(1))
				entry := hook.LastEntry()
				Expect(entry.Data).NotTo(HaveKey("error_message"))
			})
		})
	})
})
