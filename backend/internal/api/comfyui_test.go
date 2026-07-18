package api_test

import (
	"context"
	"errors"
	"fmt"
	"net"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/stretchr/testify/mock"
	goa "goa.design/goa/v3/pkg"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/apimocks"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

// newMockHealthChecker returns a generated ComfyUIHealthChecker mock whose
// HealthCheck returns the given error.
func newMockHealthChecker(err error) *apimocks.MockComfyUIHealthChecker {
	m := &apimocks.MockComfyUIHealthChecker{}
	m.EXPECT().HealthCheck(mock.Anything).Return(err).Maybe()
	return m
}

// newMockModelLister returns a generated ComfyUIModelLister mock that runs the
// given function for GetModels. A nil fn yields an empty model list.
func newMockModelLister(fn func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error)) *apimocks.MockComfyUIModelLister {
	m := &apimocks.MockComfyUIModelLister{}
	if fn == nil {
		fn = func(context.Context, service.ComfyUIModelType) ([]string, error) {
			return []string{}, nil
		}
	}
	m.EXPECT().GetModels(mock.Anything, mock.Anything).RunAndReturn(fn).Maybe()
	return m
}

var _ = Describe("ComfyUIService", func() {
	var (
		ctx context.Context
	)

	BeforeEach(func() {
		ctx = context.Background()
	})

	Describe("Status", func() {
		Context("when ComfyUI is disabled", func() {
			It("returns disabled status", func() {
				svc := api.NewComfyUIService(nil, nil)
				result, err := svc.Status(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Enabled).To(BeFalse())
				Expect(result.Connected).To(BeFalse())
			})
		})

		Context("when ComfyUI is enabled and healthy", func() {
			It("returns enabled and connected status", func() {
				mockHealth := newMockHealthChecker(nil)
				mockModels := newMockModelLister(nil)

				svc := api.NewComfyUIService(mockHealth, mockModels)
				result, err := svc.Status(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Enabled).To(BeTrue())
				Expect(result.Connected).To(BeTrue())
			})
		})

		Context("when ComfyUI is enabled but unhealthy", func() {
			It("returns enabled but not connected status", func() {
				mockHealth := newMockHealthChecker(fmt.Errorf("connection refused"))
				mockModels := newMockModelLister(nil)

				svc := api.NewComfyUIService(mockHealth, mockModels)
				result, err := svc.Status(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Enabled).To(BeTrue())
				Expect(result.Connected).To(BeFalse())
			})
		})
	})

	Describe("Models", func() {
		Context("when ComfyUI is disabled", func() {
			It("returns empty model list", func() {
				svc := api.NewComfyUIService(nil, nil)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				result, err := svc.Models(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Models).To(BeEmpty())
			})
		})

		Context("when ComfyUI is enabled", func() {
			It("returns models for VAE type", func() {
				mockHealth := newMockHealthChecker(nil)
				mockModels := newMockModelLister(func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
					Expect(modelType).To(Equal(service.ComfyUIModelTypeVAE))
					return []string{"vae1.safetensors", "vae2.safetensors"}, nil
				})

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				result, err := svc.Models(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Models).To(HaveLen(2))
				Expect(result.Models).To(ContainElements("vae1.safetensors", "vae2.safetensors"))
			})

			It("returns models for CLIP type", func() {
				mockHealth := newMockHealthChecker(nil)
				mockModels := newMockModelLister(func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
					Expect(modelType).To(Equal(service.ComfyUIModelTypeCLIP))
					return []string{"clip1.safetensors"}, nil
				})

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "clip"}
				result, err := svc.Models(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Models).To(HaveLen(1))
				Expect(result.Models).To(ContainElement("clip1.safetensors"))
			})

			// R-016: ComfyUI outages must surface with a stable, documented code
			// instead of an unmapped 500 or a silently-empty result.
			It("maps a non-network discovery failure to internal_error", func() {
				mockHealth := newMockHealthChecker(nil)
				mockModels := newMockModelLister(func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
					return nil, fmt.Errorf("malformed object info response")
				})

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				_, err := svc.Models(ctx, payload)

				Expect(err).To(HaveOccurred())
				serr, ok := err.(*goa.ServiceError)
				Expect(ok).To(BeTrue(), "expected a goa.ServiceError")
				Expect(serr.Name).To(Equal("internal_error"))
			})

			It("maps a network/connection failure to service_unavailable", func() {
				mockHealth := newMockHealthChecker(nil)
				mockModels := newMockModelLister(func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
					// Wrap a real net error the way the HTTP client would.
					return nil, fmt.Errorf("getting object info: %w", &net.OpError{
						Op:  "dial",
						Net: "tcp",
						Err: errors.New("connection refused"),
					})
				})

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				_, err := svc.Models(ctx, payload)

				Expect(err).To(HaveOccurred())
				serr, ok := err.(*goa.ServiceError)
				Expect(ok).To(BeTrue(), "expected a goa.ServiceError")
				Expect(serr.Name).To(Equal("service_unavailable"))
			})

			It("maps a context deadline to service_unavailable", func() {
				mockHealth := newMockHealthChecker(nil)
				mockModels := newMockModelLister(func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
					return nil, fmt.Errorf("requesting object info: %w", context.DeadlineExceeded)
				})

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				_, err := svc.Models(ctx, payload)

				Expect(err).To(HaveOccurred())
				serr, ok := err.(*goa.ServiceError)
				Expect(ok).To(BeTrue(), "expected a goa.ServiceError")
				Expect(serr.Name).To(Equal("service_unavailable"))
			})
		})

		Context("with different model types", func() {
			DescribeTable("accepts valid model types and passes them through",
				func(modelType string, expectedServiceType service.ComfyUIModelType) {
					mockHealth := newMockHealthChecker(nil)
					var receivedType service.ComfyUIModelType
					mockModels := newMockModelLister(func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
						receivedType = modelType
						return []string{"test-model"}, nil
					})

					svc := api.NewComfyUIService(mockHealth, mockModels)
					payload := &gencomfyui.ModelsPayload{Type: modelType}
					result, err := svc.Models(ctx, payload)

					Expect(err).NotTo(HaveOccurred())
					Expect(result).NotTo(BeNil())
					Expect(receivedType).To(Equal(expectedServiceType))
				},
				Entry("vae", "vae", service.ComfyUIModelTypeVAE),
				Entry("clip", "clip", service.ComfyUIModelTypeCLIP),
				Entry("unet", "unet", service.ComfyUIModelTypeUNET),
				Entry("lora", "lora", service.ComfyUIModelTypeLoRA),
				Entry("sampler", "sampler", service.ComfyUIModelTypeSampler),
				Entry("scheduler", "scheduler", service.ComfyUIModelTypeScheduler),
			)
		})
	})

	Describe("Service construction", func() {
		It("creates disabled service when both dependencies are nil", func() {
			svc := api.NewComfyUIService(nil, nil)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeFalse())
		})

		It("creates disabled service when health checker is nil", func() {
			mockModels := newMockModelLister(nil)
			svc := api.NewComfyUIService(nil, mockModels)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeFalse())
		})

		It("creates disabled service when model lister is nil", func() {
			mockHealth := newMockHealthChecker(nil)
			svc := api.NewComfyUIService(mockHealth, nil)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeFalse())
		})

		It("creates enabled service when both dependencies are provided", func() {
			mockHealth := newMockHealthChecker(nil)
			mockModels := newMockModelLister(nil)
			svc := api.NewComfyUIService(mockHealth, mockModels)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeTrue())
		})
	})
})
