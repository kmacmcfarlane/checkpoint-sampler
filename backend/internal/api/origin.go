package api

import (
	"net"
	"net/url"
	"strings"
)

// originAllowed implements the same-host origin policy shared by the WebSocket
// upgrader CheckOrigin hook and the CORS middleware.
//
// Policy:
//   - A request with NO Origin header is allowed (curl, non-browser clients,
//     same-origin navigations).
//   - An Origin whose hostname equals the request Host header hostname is
//     allowed. Comparison is hostname-only: scheme and port are ignored so IP
//     access, differing dev ports (Vite), and Host-preserving reverse proxies
//     (e.g. Caddy) all work.
//   - An Origin matching any entry in allowed (compared either as a full origin
//     or by hostname) is allowed. This extends the default for proxies that
//     rewrite the Host header.
//   - Any other (cross-host) Origin is rejected.
//
// originHeader is the raw value of the Origin request header (may be empty).
// hostHeader is the raw value of the request Host header (may include a port).
func originAllowed(originHeader, hostHeader string, allowed []string) bool {
	// No Origin header: allow (non-browser clients / same-origin navigations).
	if originHeader == "" {
		return true
	}

	originHost := hostnameFromOrigin(originHeader)
	if originHost == "" {
		// Unparseable Origin with a non-empty value: reject.
		return false
	}

	// Same-host default: compare hostname of Origin against hostname of Host.
	if requestHost := hostnameFromHostHeader(hostHeader); requestHost != "" {
		if strings.EqualFold(originHost, requestHost) {
			return true
		}
	}

	// allowed_origins override: accept exact full-origin match or hostname match.
	for _, entry := range allowed {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if strings.EqualFold(entry, originHeader) {
			return true
		}
		if h := hostnameFromOrigin(entry); h != "" && strings.EqualFold(h, originHost) {
			return true
		}
		// Bare hostname entry (no scheme): compare directly.
		if strings.EqualFold(entry, originHost) {
			return true
		}
	}

	return false
}

// hostnameFromOrigin extracts the lowercase hostname from an Origin-style value.
// It accepts full origins ("https://host:port") as well as bare host or
// host:port values. Returns "" if no hostname can be determined.
func hostnameFromOrigin(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	// Try parsing as a URL with a scheme first.
	if strings.Contains(v, "://") {
		if u, err := url.Parse(v); err == nil && u.Hostname() != "" {
			return strings.ToLower(u.Hostname())
		}
		return ""
	}
	// No scheme: treat as host[:port].
	return hostnameFromHostHeader(v)
}

// hostnameFromHostHeader strips an optional port from a Host header value and
// returns the lowercase hostname. Returns "" for an empty input.
func hostnameFromHostHeader(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(v); err == nil {
		return strings.ToLower(host)
	}
	// No port present (SplitHostPort errors): use as-is.
	return strings.ToLower(v)
}
