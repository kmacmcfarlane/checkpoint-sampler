package api_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
)

var _ = Describe("originAllowed (same-host origin policy)", func() {
	DescribeTable("decides whether an Origin is allowed for a given Host",
		func(origin, host string, allowed []string, expected bool) {
			Expect(api.OriginAllowedForTest(origin, host, allowed)).To(Equal(expected))
		},

		// No Origin header: always allowed (curl, non-browser, same-origin nav).
		Entry("no Origin header", "", "example.com", nil, true),
		Entry("no Origin header with allowed list", "", "example.com:8080", []string{"https://x.com"}, true),

		// Same host, different port (Vite dev server on :5173, backend on :8080).
		Entry("same host different port", "http://localhost:5173", "localhost:8080", nil, true),
		Entry("same host both with ports", "http://example.com:3000", "example.com:8080", nil, true),

		// Same host, different scheme.
		Entry("same host different scheme", "https://example.com", "example.com", nil, true),

		// IP-based same-host access.
		Entry("same IP host", "http://192.168.1.10:5173", "192.168.1.10:8080", nil, true),

		// Caddy reverse proxy preserves Host header (hostname matches).
		Entry("proxied host preserved", "https://checkpoint-sampler.mcfacehead.com", "checkpoint-sampler.mcfacehead.com", nil, true),

		// Regression (S-151 UAT): Vite dev proxy without changeOrigin preserves the
		// browser Host, so a LAN-IP dev client (Origin and Host share hostname, only
		// the WS handshake carries Origin) must upgrade successfully.
		Entry("dev LAN-IP same host WS upgrade", "http://192.168.1.241:3000", "192.168.1.241:3000", nil, true),
		Entry("dev LAN-IP proxied to backend port", "http://192.168.1.241:3000", "192.168.1.241:8080", nil, true),
		// Regression: a genuine cross-host Origin from the dev LAN client is rejected.
		Entry("dev LAN-IP cross-host rejected", "http://192.168.1.241:3000", "192.168.1.99:3000", nil, false),

		// Different host: rejected by default.
		Entry("different host", "http://evil.com", "example.com", nil, false),
		Entry("different host with port", "https://evil.com:443", "example.com:8080", nil, false),

		// allowed_origins full-origin match overrides same-host (proxy rewrites Host).
		Entry("allowed_origins full origin match", "https://app.example.com", "10.0.0.5:8080",
			[]string{"https://app.example.com"}, true),
		// allowed_origins bare hostname entry.
		Entry("allowed_origins bare hostname match", "https://app.example.com", "10.0.0.5:8080",
			[]string{"app.example.com"}, true),
		// allowed_origins matches by hostname even if port/scheme differ in the entry.
		Entry("allowed_origins hostname via differing port", "https://app.example.com:8443", "10.0.0.5:8080",
			[]string{"http://app.example.com:9000"}, true),

		// allowed_origins miss: still rejected when not same-host.
		Entry("allowed_origins miss", "https://other.example.com", "10.0.0.5:8080",
			[]string{"https://app.example.com"}, false),
		Entry("allowed_origins empty string entry ignored", "https://other.example.com", "10.0.0.5:8080",
			[]string{"", "  "}, false),

		// Unparseable non-empty Origin: rejected.
		Entry("garbage origin", "://::::", "example.com", nil, false),
	)
})
