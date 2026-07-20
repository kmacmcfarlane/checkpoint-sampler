package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// discardLogger returns a *logrus.Logger that writes nowhere. buildServer and
// serve take the concrete type because the wired service constructors do.
func discardLogger() *logrus.Logger {
	l := logrus.New()
	l.SetOutput(newDiscardWriter())
	return l
}

type discardWriter struct{}

func newDiscardWriter() *discardWriter             { return &discardWriter{} }
func (*discardWriter) Write(p []byte) (int, error) { return len(p), nil }

// testConfig builds a minimal, self-contained config rooted in a temp dir.
func testConfig(root string) *model.Config {
	checkpointDir := filepath.Join(root, "checkpoints")
	sampleDir := filepath.Join(root, "samples")
	Expect(os.MkdirAll(checkpointDir, 0o755)).To(Succeed())
	Expect(os.MkdirAll(sampleDir, 0o755)).To(Succeed())

	return &model.Config{
		CheckpointDirs:   []string{checkpointDir},
		SampleDir:        sampleDir,
		DBPath:           filepath.Join(root, "test.db"),
		Port:             0,
		IPAddress:        "127.0.0.1",
		WsPingInterval:   30,
		MaxRequestSizeMB: 200,
		MaxStudyItems:    50000,
	}
}

var _ = Describe("newLogger", func() {
	// AC: cmd/server wiring extracted into testable units with tests asserting
	// component composition.
	DescribeTable("resolves the log level from the LOG_LEVEL value",
		func(input string, expected logrus.Level) {
			logger := newLogger(input)
			logger.SetOutput(newDiscardWriter())
			Expect(logger.GetLevel()).To(Equal(expected))
		},
		Entry("empty defaults to info", "", logrus.InfoLevel),
		Entry("debug", "debug", logrus.DebugLevel),
		Entry("warn", "warn", logrus.WarnLevel),
		Entry("error", "error", logrus.ErrorLevel),
		Entry("trace", "trace", logrus.TraceLevel),
		Entry("uppercase is normalized", "DEBUG", logrus.DebugLevel),
		Entry("mixed case is normalized", "WaRn", logrus.WarnLevel),
		Entry("unparseable falls back to info", "not-a-level", logrus.InfoLevel),
	)
})

var _ = Describe("serverComponents.close", func() {
	It("runs closers in reverse registration order and is idempotent", func() {
		var order []string
		comps := &serverComponents{}
		comps.closers = append(comps.closers,
			func() { order = append(order, "first") },
			func() { order = append(order, "second") },
			func() { order = append(order, "third") },
		)

		comps.close()
		Expect(order).To(Equal([]string{"third", "second", "first"}))

		// Second call must not re-run the closers (DB double-close guard).
		comps.close()
		Expect(order).To(Equal([]string{"third", "second", "first"}))
	})
})

var _ = Describe("buildServer", func() {
	var (
		cfg    *model.Config
		logger *logrus.Logger
		comps  *serverComponents
	)

	BeforeEach(func() {
		cfg = testConfig(GinkgoT().TempDir())
		logger = discardLogger()
	})

	AfterEach(func() {
		if comps != nil {
			comps.close()
			comps = nil
		}
	})

	Context("without ComfyUI configured", func() {
		// AC: tests asserting component composition
		It("wires an HTTP server, workers and closers", func() {
			var err error
			comps, err = buildServer(cfg, []byte(`{"openapi":"3.0.3"}`), logger)
			Expect(err).NotTo(HaveOccurred())
			Expect(comps).NotTo(BeNil())

			By("constructing an HTTP server bound to the configured address")
			Expect(comps.srv).NotTo(BeNil())
			Expect(comps.srv.Handler).NotTo(BeNil())
			Expect(comps.addr).To(Equal(net.JoinHostPort(cfg.IPAddress, fmt.Sprintf("%d", cfg.Port))))
			Expect(comps.srv.Addr).To(Equal(comps.addr))

			By("applying the hardened HTTP server timeouts")
			Expect(comps.srv.ReadTimeout).To(Equal(30 * time.Second))
			Expect(comps.srv.WriteTimeout).To(Equal(30 * time.Second))
			Expect(comps.srv.IdleTimeout).To(Equal(120 * time.Second))
			Expect(comps.srv.MaxHeaderBytes).To(Equal(1 << 20))

			By("registering the watcher and fsState workers only (no job executor)")
			Expect(comps.workers).To(HaveLen(2))
			for _, w := range comps.workers {
				Expect(w).NotTo(BeNil())
			}

			By("registering closers for the store and both filesystem notifiers")
			Expect(comps.closers).To(HaveLen(3))
		})

		// AC: tests asserting component composition
		It("produces a handler that serves the health endpoint", func() {
			var err error
			comps, err = buildServer(cfg, []byte(`{"openapi":"3.0.3"}`), logger)
			Expect(err).NotTo(HaveOccurred())

			rec := newRecorder()
			req, reqErr := http.NewRequest(http.MethodGet, "/health", nil)
			Expect(reqErr).NotTo(HaveOccurred())
			comps.srv.Handler.ServeHTTP(rec, req)

			Expect(rec.status).To(Equal(http.StatusOK))
		})

		// AC: tests asserting component composition
		It("creates the database file at the configured path", func() {
			var err error
			comps, err = buildServer(cfg, []byte(`{"openapi":"3.0.3"}`), logger)
			Expect(err).NotTo(HaveOccurred())

			Expect(cfg.DBPath).To(BeAnExistingFile())
		})
	})

	Context("when wiring fails", func() {
		It("returns an error and releases already-registered resources", func() {
			// A directory where the DB file should be makes store.OpenDB fail.
			dbDir := filepath.Join(cfg.SampleDir, "not-a-db")
			Expect(os.MkdirAll(dbDir, 0o755)).To(Succeed())
			cfg.DBPath = dbDir

			var err error
			comps, err = buildServer(cfg, []byte(`{}`), logger)
			Expect(err).To(HaveOccurred())
			Expect(comps).To(BeNil())
		})

		It("returns an error when the ComfyUI workflow dir cannot be created", func() {
			// Point workflow_dir at a path under an existing *file* so
			// EnsureWorkflowDir fails.
			blocker := filepath.Join(cfg.SampleDir, "blocker")
			Expect(os.WriteFile(blocker, []byte("x"), 0o644)).To(Succeed())
			cfg.ComfyUI = &model.ComfyUIConfig{
				URL:               "http://127.0.0.1:1",
				WorkflowDir:       filepath.Join(blocker, "workflows"),
				ReconnectInterval: 10,
			}

			var err error
			comps, err = buildServer(cfg, []byte(`{}`), logger)
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("ensuring workflow directory"))
			Expect(comps).To(BeNil())
		})
	})
})

var _ = Describe("serve", func() {
	var (
		logger *logrus.Logger
		ln     net.Listener
	)

	BeforeEach(func() {
		logger = discardLogger()
		var err error
		// Ephemeral port: no fixed-port collisions, no external network.
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		Expect(err).NotTo(HaveOccurred())
	})

	// AC: tests asserting graceful-shutdown behavior
	It("serves requests until the context is cancelled, then shuts down gracefully", func() {
		var seq []string
		worker := newFakeWorker("worker", &seq)

		comps := &serverComponents{
			srv: &http.Server{
				Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					w.WriteHeader(http.StatusTeapot)
				}),
				ReadTimeout:  time.Second,
				WriteTimeout: time.Second,
			},
			workers: []Stoppable{worker},
		}

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		done := make(chan error, 1)
		go func() { done <- serve(ctx, comps, ln, logger) }()

		By("answering a request while running")
		url := "http://" + ln.Addr().String() + "/"
		Eventually(func() int {
			resp, err := http.Get(url) //nolint:noctx // short-lived test request
			if err != nil {
				return 0
			}
			defer resp.Body.Close()
			return resp.StatusCode
		}, 2*time.Second, 10*time.Millisecond).Should(Equal(http.StatusTeapot))

		By("returning nil once the shutdown signal context is cancelled")
		cancel()
		Eventually(done, 5*time.Second).Should(Receive(BeNil()))

		By("stopping background workers before the HTTP drain")
		Expect(worker.wasStopped()).To(BeTrue())
		Expect(seq).To(Equal([]string{"worker"}))

		By("closing the listener so the port is released")
		_, err := http.Get(url) //nolint:noctx // short-lived test request
		Expect(err).To(HaveOccurred())
	})

	// AC: tests asserting graceful-shutdown behavior
	It("does not return before the shutdown goroutine has finished", func() {
		// A handler that blocks until released proves serve() waits for the
		// in-flight request to drain rather than returning immediately.
		release := make(chan struct{})
		handlerEntered := make(chan struct{})
		comps := &serverComponents{
			srv: &http.Server{
				Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
					close(handlerEntered)
					<-release
					w.WriteHeader(http.StatusOK)
				}),
			},
		}

		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		done := make(chan error, 1)
		go func() { done <- serve(ctx, comps, ln, logger) }()

		url := "http://" + ln.Addr().String() + "/"
		go func() {
			resp, err := http.Get(url) //nolint:noctx // short-lived test request
			if err == nil {
				_ = resp.Body.Close()
			}
		}()

		Eventually(handlerEntered, 2*time.Second).Should(BeClosed())
		cancel()

		By("staying blocked while the request is still in flight")
		Consistently(done, 100*time.Millisecond, 10*time.Millisecond).ShouldNot(Receive())

		By("returning once the in-flight request completes")
		close(release)
		Eventually(done, 5*time.Second).Should(Receive(BeNil()))
	})

	// AC: serve() waits on shutdownDone on ALL return paths, not just the
	// ErrServerClosed path; workers are stopped before shutdown completes even
	// when Serve fails for a non-ErrServerClosed reason. serve() must trigger
	// its own shutdown in this case rather than waiting for an external
	// signal, so it does not hang the process on a genuine Serve error.
	It("returns an error when the server fails for a non-ErrServerClosed reason, but still waits for workers to stop", func() {
		var seq []string
		worker := newFakeWorker("worker", &seq)
		comps := &serverComponents{
			srv:     &http.Server{Handler: http.NewServeMux()},
			workers: []Stoppable{worker},
		}

		// Closing the listener up front makes Serve fail immediately with
		// something other than http.ErrServerClosed.
		Expect(ln.Close()).To(Succeed())

		// A context that is never cancelled by the test proves serve() drives
		// its own shutdown on a Serve error, rather than depending on an
		// external signal to unblock performShutdown.
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()

		done := make(chan error, 1)
		go func() { done <- serve(ctx, comps, ln, logger) }()

		By("returning promptly on its own once Serve fails, without waiting for the context to be cancelled")
		Eventually(done, 5*time.Second).Should(Receive(MatchError(ContainSubstring("server error"))))

		By("having stopped the worker by the time the error is returned")
		Expect(worker.wasStopped()).To(BeTrue())
	})
})

// recorder is a tiny http.ResponseWriter capturing the status code.
type recorder struct {
	header http.Header
	status int
	body   []byte
}

func newRecorder() *recorder {
	return &recorder{header: http.Header{}, status: http.StatusOK}
}

func (r *recorder) Header() http.Header { return r.header }

func (r *recorder) Write(p []byte) (int, error) {
	r.body = append(r.body, p...)
	return len(p), nil
}

func (r *recorder) WriteHeader(code int) { r.status = code }
