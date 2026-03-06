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

// fakePauser is a test double for the BackgroundPauser interface.
type fakePauser struct {
	pauseCalled  bool
	resumeCalled bool
	// pauseOrder and resumeOrder record when each was called relative to
	// the resetter, allowing tests to verify correct ordering.
	pauseOrder  int
	resumeOrder int
	callCounter *int
}

func newFakePauser() *fakePauser {
	counter := 0
	return &fakePauser{callCounter: &counter}
}

func (f *fakePauser) Pause() {
	f.pauseCalled = true
	*f.callCounter++
	f.pauseOrder = *f.callCounter
}

func (f *fakePauser) Resume() {
	f.resumeCalled = true
	*f.callCounter++
	f.resumeOrder = *f.callCounter
}

// fakeSampleDirCleaner is a test double for the SampleDirCleaner interface.
type fakeSampleDirCleaner struct {
	called bool
	err    error
}

func (f *fakeSampleDirCleaner) CleanStudyDirs() error {
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
			api.MountTestResetEndpoint(mux, resetter, nil, nil, logger)

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
			api.MountTestResetEndpoint(mux, resetter, nil, nil, logger)

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
			api.MountTestResetEndpoint(mux, resetter, nil, nil, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
		})

		// AC: The test reset endpoint pauses or synchronizes with the job
		// executor to prevent SQL errors during table recreation.
		It("pauses and resumes the background pauser during reset", func() {
			pauser := newFakePauser()
			api.MountTestResetEndpoint(mux, resetter, pauser, nil, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(pauser.pauseCalled).To(BeTrue())
			Expect(pauser.resumeCalled).To(BeTrue())
			// Pause must be called before Resume
			Expect(pauser.pauseOrder).To(BeNumerically("<", pauser.resumeOrder))
		})

		It("resumes the pauser even when ResetDB fails", func() {
			resetter.err = fmt.Errorf("db error")
			pauser := newFakePauser()
			api.MountTestResetEndpoint(mux, resetter, pauser, nil, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
			// Even on failure, Resume must be called (via defer)
			Expect(pauser.pauseCalled).To(BeTrue())
			Expect(pauser.resumeCalled).To(BeTrue())
		})

		It("works without a pauser (nil pauser)", func() {
			api.MountTestResetEndpoint(mux, resetter, nil, nil, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resetter.called).To(BeTrue())
		})

		It("calls CleanStudyDirs when a sample dir cleaner is provided", func() {
			cleaner := &fakeSampleDirCleaner{}
			api.MountTestResetEndpoint(mux, resetter, nil, cleaner, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resetter.called).To(BeTrue())
			Expect(cleaner.called).To(BeTrue())
		})

		It("returns 500 when CleanStudyDirs fails", func() {
			cleaner := &fakeSampleDirCleaner{err: fmt.Errorf("cleanup error")}
			api.MountTestResetEndpoint(mux, resetter, nil, cleaner, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
		})

		It("works without a sample dir cleaner (nil cleaner)", func() {
			api.MountTestResetEndpoint(mux, resetter, nil, nil, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusOK))
			Expect(resetter.called).To(BeTrue())
		})

		It("does not call CleanStudyDirs when ResetDB fails", func() {
			resetter.err = fmt.Errorf("db error")
			cleaner := &fakeSampleDirCleaner{}
			api.MountTestResetEndpoint(mux, resetter, nil, cleaner, logger)

			server := httptest.NewServer(mux)
			defer server.Close()

			req, err := http.NewRequest(http.MethodDelete, server.URL+"/api/test/reset", nil)
			Expect(err).NotTo(HaveOccurred())

			resp, err := http.DefaultClient.Do(req)
			Expect(err).NotTo(HaveOccurred())
			defer resp.Body.Close()

			Expect(resp.StatusCode).To(Equal(http.StatusInternalServerError))
			// CleanStudyDirs should NOT be called when DB reset fails
			Expect(cleaner.called).To(BeFalse())
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
			api.MountTestResetEndpoint(mux, resetter, nil, nil, logger)

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
