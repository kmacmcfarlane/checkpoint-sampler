package api_test

import (
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("CORSMiddleware", func() {
	var recorder *httptest.ResponseRecorder

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	BeforeEach(func() {
		recorder = httptest.NewRecorder()
	})

	// newReq builds a request with the given method, Host header, and optional
	// Origin header (omitted when origin == "").
	newReq := func(method, host, origin string) *http.Request {
		req := httptest.NewRequest(method, "http://"+host+"/test", nil)
		req.Host = host
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		return req
	}

	Context("with no allowed_origins (same-host default only)", func() {
		var handler http.Handler

		BeforeEach(func() {
			handler = api.CORSMiddleware(nil)(inner)
		})

		It("allows requests with no Origin header (no allow-origin echoed)", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "example.com", ""))

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(BeEmpty())
			Expect(recorder.Body.String()).To(Equal("ok"))
		})

		It("echoes the Origin when its hostname matches the Host hostname", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "example.com", "http://example.com"))

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("http://example.com"))
			Expect(recorder.Header().Get("Vary")).To(Equal("Origin"))
		})

		It("allows same host with a different port (dev mode)", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "localhost:8080", "http://localhost:5173"))

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("http://localhost:5173"))
		})

		It("allows same host with a different scheme", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "example.com", "https://example.com"))

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("https://example.com"))
		})

		It("rejects a cross-host Origin by omitting allow-origin", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "example.com", "http://evil.com"))

			// Inner handler still runs, but no CORS header is set so the
			// browser blocks the response from being read.
			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(BeEmpty())
			Expect(recorder.Header().Get("Access-Control-Allow-Methods")).To(BeEmpty())
		})

		It("refuses a cross-host OPTIONS preflight with 403", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodOptions, "example.com", "http://evil.com"))

			Expect(recorder.Code).To(Equal(http.StatusForbidden))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(BeEmpty())
		})

		It("handles a same-host OPTIONS preflight with 200 and echoed origin", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodOptions, "example.com", "http://example.com"))

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("http://example.com"))
			Expect(recorder.Body.String()).To(BeEmpty())
		})
	})

	Context("with allowed_origins override", func() {
		var handler http.Handler

		BeforeEach(func() {
			handler = api.CORSMiddleware([]string{"https://checkpoint-sampler.mcfacehead.com"})(inner)
		})

		It("allows an Origin matching an allowed_origins entry on a different host", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "10.0.0.5:8080", "https://checkpoint-sampler.mcfacehead.com"))

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("https://checkpoint-sampler.mcfacehead.com"))
		})

		It("rejects an Origin not in allowed_origins and not same-host", func() {
			handler.ServeHTTP(recorder, newReq(http.MethodGet, "10.0.0.5:8080", "https://other.example.com"))

			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(BeEmpty())
		})
	})
})
