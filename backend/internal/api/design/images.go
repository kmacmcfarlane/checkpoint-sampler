package design

import (
	. "goa.design/goa/v3/dsl"
)

var _ = Service("images", func() {
	Description("Image serving and metadata service")

	Method("download", func() {
		Description("Download an image file from the sample directory")
		Payload(func() {
			Attribute("filepath", String, "Relative path to the image file", func() {
				Example("checkpoint.safetensors/image.png")
			})
			Required("filepath")
		})
		Result(ImageDownloadResult)
		Error("not_found", ErrorResult, "Image file not found")
		Error("bad_request", ErrorResult, "Invalid file path (traversal rejected)")
		HTTP(func() {
			GET("/api/images/{*filepath}")
			SkipResponseBodyEncodeDecode()
			Response(StatusOK, func() {
				Header("content_type:Content-Type")
				Header("content_length:Content-Length")
				Header("cache_control:Cache-Control")
			})
			Response("not_found", StatusNotFound)
			Response("bad_request", StatusBadRequest)
		})
	})

	Method("metadata", func() {
		Description("Get PNG tEXt chunk metadata from an image file")
		Payload(func() {
			Attribute("filepath", String, "Relative path to the image file", func() {
				Example("checkpoint.safetensors/image.png")
			})
			Required("filepath")
		})
		Result(ImageMetadataResponse)
		Error("not_found", ErrorResult, "Image file not found")
		Error("bad_request", ErrorResult, "Invalid file path (traversal rejected)")
		HTTP(func() {
			// Note: The actual HTTP path will be /api/images/{filepath}/metadata
			// but we register it under a different pattern due to chi router limitations
			// and use a custom handler wrapper in http.go to route it correctly
			GET("/api/_images_metadata/{*filepath}")
			Response(StatusOK)
			Response("not_found", StatusNotFound)
			Response("bad_request", StatusBadRequest)
		})
	})
})

var ImageDownloadResult = Type("ImageDownloadResult", func() {
	Description("Result headers for image download")
	Attribute("content_type", String, "Content-Type header value", func() {
		Example("image/png")
	})
	Attribute("content_length", Int64, "Content-Length header value", func() {
		Example(123456)
	})
	Attribute("cache_control", String, "Cache-Control header value", func() {
		Example("max-age=31536000, immutable")
	})
	Required("content_type", "content_length", "cache_control")
})

var ImageMetadataResponse = Type("ImageMetadataResponse", func() {
	Description("PNG metadata extracted from tEXt chunks")
	Attribute("metadata", MapOf(String, String), "Key-value pairs from PNG tEXt chunks", func() {
		Example(map[string]string{
			"prompt":   `{"3": {"class_type": "KSampler"}}`,
			"workflow": `{"nodes": []}`,
		})
	})
	Required("metadata")
})
