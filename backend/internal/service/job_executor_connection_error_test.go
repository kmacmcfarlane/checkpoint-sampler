package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"syscall"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// timeoutError is a net.Error whose Timeout() reports true, used to exercise the
// net.Error timeout branch of isConnectionError without performing real I/O.
type timeoutError struct{}

func (timeoutError) Error() string   { return "i/o timeout" }
func (timeoutError) Timeout() bool   { return true }
func (timeoutError) Temporary() bool { return true }

// R-015: isConnectionError must classify failures via typed checks
// (errors.As / errors.Is), never by matching error message substrings. The
// critical regression guard is that a ComfyUI node-execution error whose human
// text merely mentions transport words ("network", "timeout", "eof", ...) is
// NOT treated as a connection error and does not trigger a bogus reconnect.
var _ = Describe("isConnectionError", func() {
	DescribeTable("classifies transport-level failures as connection errors",
		func(err error) {
			Expect(isConnectionError(err)).To(BeTrue())
		},
		Entry("nil-safe: net timeout", net.Error(timeoutError{})),
		Entry("wrapped net timeout", fmt.Errorf("submitting prompt: %w", net.Error(timeoutError{}))),
		Entry("context deadline exceeded", context.DeadlineExceeded),
		Entry("wrapped context deadline", fmt.Errorf("dialing comfyui: %w", context.DeadlineExceeded)),
		Entry("connection refused errno", &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}),
		Entry("connection reset errno", fmt.Errorf("read: %w", syscall.ECONNRESET)),
		Entry("broken pipe errno", fmt.Errorf("write: %w", syscall.EPIPE)),
		Entry("net.OpError", &net.OpError{Op: "read", Err: errors.New("use of closed network connection")}),
		Entry("io.EOF", io.EOF),
		Entry("wrapped io.ErrUnexpectedEOF", fmt.Errorf("decoding response: %w", io.ErrUnexpectedEOF)),
	)

	DescribeTable("does NOT classify non-transport errors as connection errors",
		func(err error) {
			Expect(isConnectionError(err)).To(BeFalse())
		},
		Entry("nil error", nil),
		// AC3: a ComfyUI node error mentioning 'network' must NOT be a connection error.
		Entry("node error text containing 'network'",
			errors.New("[KSampler] NetworkLoader: failed to load network weights")),
		Entry("node error text containing 'timeout'",
			errors.New("[Sampler] node timeout configuration is invalid")),
		Entry("node error text containing 'eof'",
			errors.New("unexpected eof token in user prompt")),
		Entry("node error text containing 'connection'",
			errors.New("invalid connection between node 4 and node 7")),
		Entry("generic ComfyUI execution error",
			errors.New("[ValueError] CLIPTextEncode: prompt exceeds max length")),
	)
})
