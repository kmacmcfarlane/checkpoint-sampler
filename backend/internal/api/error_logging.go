package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"

	"github.com/sirupsen/logrus"
	goamiddleware "goa.design/goa/v3/middleware"
)

// ErrorLoggingMiddleware returns middleware that logs HTTP errors (4xx and 5xx responses)
// with contextual information including request ID, method, path, status code, and error message.
// It uses warn level for 4xx (client errors) and error level for 5xx (server errors).
func ErrorLoggingMiddleware(logger *logrus.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Wrap the response writer to capture status code and body
			wrapped := &statusCapturingWriter{
				ResponseWriter: w,
				statusCode:     http.StatusOK, // Default to 200 if WriteHeader is never called
				body:           &bytes.Buffer{},
			}

			// Call the next handler
			next.ServeHTTP(wrapped, r)

			// Log if this was an error response
			if wrapped.statusCode >= 400 {
				logErrorResponse(r.Context(), logger, r, wrapped.statusCode, wrapped.body.Bytes())
			}
		})
	}
}

// statusCapturingWriter wraps http.ResponseWriter to capture the status code and response body
type statusCapturingWriter struct {
	http.ResponseWriter
	statusCode int
	body       *bytes.Buffer
}

// WriteHeader captures the status code before passing it through
func (w *statusCapturingWriter) WriteHeader(code int) {
	w.statusCode = code
	w.ResponseWriter.WriteHeader(code)
}

// Write captures the response body for error responses and passes it through
func (w *statusCapturingWriter) Write(b []byte) (int, error) {
	// If WriteHeader wasn't called, the first Write call triggers an implicit 200
	// Our default statusCode is already 200, so we're covered

	// Buffer the body if this is an error response
	if w.statusCode >= 400 {
		w.body.Write(b)
	}

	return w.ResponseWriter.Write(b)
}

// Hijack implements http.Hijacker to support WebSocket upgrades
func (w *statusCapturingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := w.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, fmt.Errorf("response writer does not support hijacking: %T", w.ResponseWriter)
}

// logErrorResponse logs an error response with appropriate context and log level
func logErrorResponse(ctx context.Context, logger *logrus.Logger, r *http.Request, statusCode int, body []byte) {
	// Extract request ID from context
	requestID, _ := ctx.Value(goamiddleware.RequestIDKey).(string)

	fields := logrus.Fields{
		"request_id":  requestID,
		"method":      r.Method,
		"path":        r.URL.Path,
		"status_code": statusCode,
	}

	// Try to extract error message from response body
	if len(body) > 0 {
		var errorBody struct {
			Message string `json:"message"`
			Error   string `json:"error"`
		}
		if err := json.Unmarshal(body, &errorBody); err == nil {
			// Prefer "message" field, fall back to "error" field
			if errorBody.Message != "" {
				fields["error_message"] = errorBody.Message
			} else if errorBody.Error != "" {
				fields["error_message"] = errorBody.Error
			}
		} else {
			// Non-JSON response, use truncated raw body
			maxBodyLen := 200
			if len(body) > maxBodyLen {
				fields["error_message"] = string(body[:maxBodyLen]) + "..."
			} else {
				fields["error_message"] = string(body)
			}
		}
	}

	// Determine log level and message based on status code
	var logLevel logrus.Level
	var message string

	if statusCode >= 500 {
		logLevel = logrus.ErrorLevel
		message = "HTTP server error"
	} else {
		logLevel = logrus.WarnLevel
		message = "HTTP client error"
	}

	// Log at the appropriate level
	logger.WithFields(fields).Log(logLevel, message)
}
