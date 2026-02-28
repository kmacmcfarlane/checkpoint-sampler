package api_test

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	goahttp "goa.design/goa/v3/http"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

// fakeDBResetter is a test double for the DBResetter interface.
type fakeDBResetter struct {
	called bool
	err    error
}

func (f *fakeDBResetter) ResetDB() error {
	f.called = true
	return f.err
}

var _ = Describe("MountTestResetEndpoint", func() {
	var (
		mux      goahttp.Muxer
		resetter *fakeDBResetter
		logger   *logrus.Logger
	)

	BeforeEach(func() {
		mux = goahttp.NewMuxer()
		resetter = &fakeDBResetter{}
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	Context("when ENABLE_TEST_ENDPOINTS is not set", func() {
		BeforeEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("does not mount the endpoint", func() {
			api.MountTestResetEndpoint(mux, resetter, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			// The mux should return 405 or 404 since nothing is mounted
			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK))
			Expect(resetter.called).To(BeFalse())
		})
	})

	Context("when ENABLE_TEST_ENDPOINTS is true", func() {
		BeforeEach(func() {
			os.Setenv("ENABLE_TEST_ENDPOINTS", "true")
		})

		AfterEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("mounts the endpoint and calls ResetDB on DELETE", func() {
			api.MountTestResetEndpoint(mux, resetter, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resetter.called).To(BeTrue())

			body, err := io.ReadAll(resp.Body)
			Expect(err).NotTo(HaveOccurred())
			Expect(string(body)).To(ContainSubstring("reset_complete"))
		})

		It("returns 500 when ResetDB fails", func() {
			resetter.err = fmt.Errorf("db error")
			api.MountTestResetEndpoint(mux, resetter, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
		})
	})

	Context("when ENABLE_TEST_ENDPOINTS is set to a non-true value", func() {
		BeforeEach(func() {
			os.Setenv("ENABLE_TEST_ENDPOINTS", "false")
		})

		AfterEach(func() {
			os.Unsetenv("ENABLE_TEST_ENDPOINTS")
		})

		It("does not mount the endpoint", func() {
			api.MountTestResetEndpoint(mux, resetter, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).NotTo(Equal(http.StatusOK))
			Expect(resetter.called).To(BeFalse())
		})
	})
})
