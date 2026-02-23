package api_test

import (
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("CORSMiddleware", func() {
	var (
		handler  http.Handler
		recorder *httptest.ResponseRecorder
	)

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	BeforeEach(func() {
		recorder = httptest.NewRecorder()
	})

	Context("with wildcard origin", func() {
		BeforeEach(func() {
			handler = api.CORSMiddleware("*")(inner)
		})

		It("adds CORS headers to regular requests", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("*"))
			Expect(recorder.Header().Get("Access-Control-Allow-Methods")).To(ContainSubstring("GET"))
			Expect(recorder.Header().Get("Access-Control-Allow-Methods")).To(ContainSubstring("POST"))
			Expect(recorder.Header().Get("Access-Control-Allow-Methods")).To(ContainSubstring("PUT"))
			Expect(recorder.Header().Get("Access-Control-Allow-Methods")).To(ContainSubstring("DELETE"))
			Expect(recorder.Body.String()).To(Equal("ok"))
		})

		It("handles OPTIONS preflight requests", func() {
			req := httptest.NewRequest(http.MethodOptions, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Code).To(Equal(http.StatusOK))
			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("*"))
			Expect(recorder.Body.String()).To(BeEmpty())
		})
	})

	Context("with specific origin", func() {
		BeforeEach(func() {
			handler = api.CORSMiddleware("http://localhost:3000")(inner)
		})

		It("sets the specific origin in the header", func() {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			handler.ServeHTTP(recorder, req)

			Expect(recorder.Header().Get("Access-Control-Allow-Origin")).To(Equal("http://localhost:3000"))
		})
	})
})
