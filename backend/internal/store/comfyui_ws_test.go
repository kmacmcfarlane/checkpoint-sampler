package store_test

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"
	"io"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

var _ = Describe("ComfyUIWSClient", func() {
	var logger *logrus.Logger

	BeforeEach(func() {
		logger = logrus.New()
		logger.SetOutput(io.Discard)
	})

	Describe("NewComfyUIWSClient", func() {
		It("creates a client", func() {
			client := store.NewComfyUIWSClient("http://localhost:8188", logger)
			Expect(client).NotTo(BeNil())
		})
	})

	Describe("DeriveWebSocketURL", func() {
		DescribeTable("derives WebSocket URL from HTTP URL",
			func(httpURL string, expectedWSURL string) {
				wsURL := store.DeriveWebSocketURL(httpURL)
				Expect(wsURL).To(Equal(expectedWSURL))
			},
			Entry("http to ws",
				"http://localhost:8188",
				"ws://localhost:8188/ws",
			),
			Entry("https to wss",
				"https://comfyui.example.com",
				"wss://comfyui.example.com/ws",
			),
			Entry("http with port to ws with port",
				"http://192.168.1.100:8188",
				"ws://192.168.1.100:8188/ws",
			),
			Entry("https with port to wss with port",
				"https://comfyui.example.com:443",
				"wss://comfyui.example.com:443/ws",
			),
		)
	})
})
