package api

import (
	"encoding/json"
	"net/http"
)

// RequestBodyLimitMiddleware returns middleware that guards against
// memory-exhaustion DoS from oversized request bodies.
//
// Two enforcement paths:
//  1. Content-Length fast path: if the client declares a body larger than the
//     limit, we write a 413 JSON envelope immediately and return — no bytes of
//     the body are read.
//  2. Streaming / chunked path: we wrap r.Body with http.MaxBytesReader, which
//     caps reads at the configured limit. If the body overruns, MaxBytesReader
//     returns *http.MaxBytesError to Goa's decoder (typically surfaced as 400).
//     Aborting oversized streaming bodies at the transport layer is standard
//     behavior and is sufficient DoS protection.
//
// The response writer is never wrapped, so image downloads and WebSocket
// upgrades pass through with zero overhead.
func RequestBodyLimitMiddleware(limitMB int) func(http.Handler) http.Handler {
	limit := int64(limitMB) * 1024 * 1024
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Fast path: Content-Length declared above the limit.
			if r.ContentLength > limit {
				writeBodyTooLargeJSON(w)
				return
			}

			// Streaming path: cap reads without buffering the response.
			r2 := r.Clone(r.Context())
			r2.Body = http.MaxBytesReader(w, r.Body, limit)
			next.ServeHTTP(w, r2)
		})
	}
}

// writeBodyTooLargeJSON writes a 413 response with a JSON body matching Goa's
// ErrorResponse format: {"name":…,"id":"","message":…,"temporary":…,…}.
func writeBodyTooLargeJSON(w http.ResponseWriter) {
	body, _ := json.Marshal(map[string]any{
		"name":      "request_entity_too_large",
		"id":        "",
		"message":   "request body too large",
		"temporary": false,
		"timeout":   false,
		"fault":     false,
	})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusRequestEntityTooLarge)
	_, _ = w.Write(body)
}
