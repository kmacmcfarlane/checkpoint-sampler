package api

import (
	"net/http"
	"net/http/httptest"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

// AC (R-022): frontend percent-encodes image filepath segments. The metadata
// rewrite middleware must keep URL.Path and URL.RawPath consistent, because chi
// routes on RawPath whenever it is non-empty — a stale RawPath makes the
// rewritten request fail to match the metadata route entirely.
var _ = Describe("imageMetadataRewriteMiddleware", func() {
	// captured holds what the downstream handler observed.
	type captured struct {
		path    string
		rawPath string
	}

	// serve runs the middleware against rawURL and returns what the next
	// handler saw. rawURL is the on-the-wire (escaped) request target.
	serve := func(rawURL string) captured {
		var got captured
		next := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			got = captured{path: r.URL.Path, rawPath: r.URL.RawPath}
		})
		req := httptest.NewRequest(http.MethodGet, rawURL, nil)
		imageMetadataRewriteMiddleware(next).ServeHTTP(httptest.NewRecorder(), req)
		return got
	}

	It("rewrites an unencoded metadata path", func() {
		got := serve("/api/v1/images/run/ckpt/image.png/metadata")
		Expect(got.path).To(Equal("/api/v1/_images_metadata/run/ckpt/image.png"))
	})

	It("rewrites a percent-encoded path and keeps RawPath in sync", func() {
		// Filename "step=500&cfg=7.png" as encoded by the frontend.
		got := serve("/api/v1/images/run/step%3D500%26cfg%3D7.png/metadata")

		// Decoded path for handlers that read Path.
		Expect(got.path).To(Equal("/api/v1/_images_metadata/run/step=500&cfg=7.png"))
		// Escaped path for chi's router — must no longer contain the original
		// /api/v1/images prefix or the /metadata suffix.
		Expect(got.rawPath).To(Equal("/api/v1/_images_metadata/run/step%3D500%26cfg%3D7.png"))
		Expect(got.rawPath).ToNot(ContainSubstring("/metadata"))
		Expect(got.rawPath).ToNot(ContainSubstring("/api/v1/images/"))
	})

	DescribeTable("round-trips filenames with URL-significant characters",
		func(escapedSegment, wantDecoded string) {
			got := serve("/api/v1/images/run/" + escapedSegment + "/metadata")
			Expect(got.path).To(Equal("/api/v1/_images_metadata/run/" + wantDecoded))
			Expect(got.rawPath).To(Equal("/api/v1/_images_metadata/run/" + escapedSegment))
		},
		Entry("hash", "a%23b.png", "a#b.png"),
		Entry("question mark", "a%3Fb.png", "a?b.png"),
		Entry("percent", "100%25.png", "100%.png"),
		Entry("space", "a%20b.png", "a b.png"),
		Entry("ampersand and equals", "a%26b%3Dc.png", "a&b=c.png"),
	)

	It("passes through non-metadata image requests untouched", func() {
		got := serve("/api/v1/images/run/image.png")
		Expect(got.path).To(Equal("/api/v1/images/run/image.png"))
	})

	It("passes through unrelated paths untouched", func() {
		got := serve("/api/v1/studies/123")
		Expect(got.path).To(Equal("/api/v1/studies/123"))
	})

	It("passes through when the filepath is empty", func() {
		got := serve("/api/v1/images//metadata")
		Expect(got.path).To(Equal("/api/v1/images//metadata"))
	})
})
