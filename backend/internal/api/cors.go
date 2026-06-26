package api

import "net/http"

// CORSMiddleware returns middleware that adds CORS headers to responses using
// the same-host origin policy (see originAllowed).
//
// When a browser sends an Origin header that the policy rejects (a cross-host
// origin not present in allowedOrigins), the Access-Control-Allow-Origin header
// is omitted so the browser blocks the response from being read. When the
// Origin is allowed, it is echoed back (never "*") so credentials and cross-port
// dev setups work. Requests without an Origin header (curl, same-origin
// navigations) are always allowed and receive permissive method/header CORS
// values without an explicit allow-origin.
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			allowed := originAllowed(origin, r.Host, allowedOrigins)

			if allowed {
				// Echo the request Origin when present (never "*") so the
				// browser permits cross-port/proxy reads.
				if origin != "" {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
				}
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			}

			if r.Method == http.MethodOptions {
				if allowed {
					w.WriteHeader(http.StatusOK)
				} else {
					// Cross-host preflight: refuse without CORS headers.
					w.WriteHeader(http.StatusForbidden)
				}
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
