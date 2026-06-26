package main

import (
	"context"
	"errors"
	"io"
	"sync"
	"time"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
)

// noopLogger returns a logrus logger that discards all output.
func noopLogger() logrus.FieldLogger {
	l := logrus.New()
	l.SetOutput(io.Discard)
	return l
}

// fakeWorker records whether Stop was called and in which order relative to
// the fake HTTP server's Shutdown call.
type fakeWorker struct {
	mu       sync.Mutex
	stopped  bool
	stopAt   int // position in a shared call-order counter when Stop ran
	sequence *[]string
	name     string
}

func newFakeWorker(name string, seq *[]string) *fakeWorker {
	return &fakeWorker{name: name, sequence: seq}
}

func (f *fakeWorker) Stop() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stopped = true
	*f.sequence = append(*f.sequence, f.name)
}

func (f *fakeWorker) wasStopped() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.stopped
}

// fakeHTTPServer records the order of its Shutdown call.
type fakeHTTPServer struct {
	mu           sync.Mutex
	shutdownCh   chan struct{} // close to unblock Shutdown (simulate in-flight drain)
	sequence     *[]string
	shutdownErr  error
	shutdownDone bool
}

func newFakeHTTPServer(seq *[]string) *fakeHTTPServer {
	return &fakeHTTPServer{
		shutdownCh: make(chan struct{}),
		sequence:   seq,
	}
}

func (f *fakeHTTPServer) Shutdown(ctx context.Context) error {
	// Block until the test releases the drain gate.
	select {
	case <-f.shutdownCh:
	case <-ctx.Done():
		return ctx.Err()
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.shutdownDone = true
	*f.sequence = append(*f.sequence, "http.Shutdown")
	return f.shutdownErr
}

func (f *fakeHTTPServer) release() {
	select {
	case <-f.shutdownCh: // already released
	default:
		close(f.shutdownCh)
	}
}

var _ = Describe("performShutdown", func() {
	var (
		seq        []string
		worker1    *fakeWorker
		worker2    *fakeWorker
		httpServer *fakeHTTPServer
		signalCtx  context.Context
		cancel     context.CancelFunc
	)

	BeforeEach(func() {
		seq = nil
		worker1 = newFakeWorker("worker1", &seq)
		worker2 = newFakeWorker("worker2", &seq)
		httpServer = newFakeHTTPServer(&seq)
		signalCtx, cancel = context.WithCancel(context.Background())
	})

	AfterEach(func() {
		cancel()
		httpServer.release() // prevent test goroutine leak
	})

	It("stops workers before draining HTTP", func() {
		// Release the HTTP drain gate immediately.
		httpServer.release()
		cancel() // trigger shutdown

		err := performShutdown(signalCtx, httpServer, []Stoppable{worker1, worker2}, 5*time.Second, noopLogger())

		Expect(err).NotTo(HaveOccurred())
		Expect(worker1.wasStopped()).To(BeTrue(), "worker1 should have been stopped")
		Expect(worker2.wasStopped()).To(BeTrue(), "worker2 should have been stopped")
		Expect(httpServer.shutdownDone).To(BeTrue(), "HTTP server should have been shut down")

		// Verify ordering: workers precede HTTP drain.
		Expect(seq).To(Equal([]string{"worker1", "worker2", "http.Shutdown"}))
	})

	It("blocks until HTTP drain completes", func() {
		// This test verifies that performShutdown does NOT return before
		// Shutdown returns (i.e. it waits for in-flight requests to drain).
		done := make(chan error, 1)
		cancel() // trigger shutdown

		go func() {
			done <- performShutdown(signalCtx, httpServer, nil, 5*time.Second, noopLogger())
		}()

		// performShutdown should not have returned yet because httpServer.Shutdown
		// is still blocked.
		Consistently(done, 50*time.Millisecond, 10*time.Millisecond).ShouldNot(Receive())

		// Release the drain gate — now performShutdown should complete.
		httpServer.release()
		Eventually(done, time.Second).Should(Receive(BeNil()))
	})

	It("returns the HTTP shutdown error when Shutdown fails", func() {
		httpServer.shutdownErr = errors.New("context deadline exceeded")
		httpServer.release()
		cancel()

		err := performShutdown(signalCtx, httpServer, nil, 5*time.Second, noopLogger())

		Expect(err).To(MatchError("context deadline exceeded"))
	})

	It("skips nil workers without panicking", func() {
		httpServer.release()
		cancel()

		err := performShutdown(signalCtx, httpServer, []Stoppable{nil, worker1, nil}, 5*time.Second, noopLogger())

		Expect(err).NotTo(HaveOccurred())
		Expect(worker1.wasStopped()).To(BeTrue())
	})
})
