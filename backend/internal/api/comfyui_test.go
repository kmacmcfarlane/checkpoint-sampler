package api_test

import (
	"context"
	"fmt"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/comfyui"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
)

// mockHealthChecker implements the ComfyUIHealthChecker interface for testing
type mockHealthChecker struct {
	healthCheckFunc func(ctx context.Context) error
}

func (m *mockHealthChecker) HealthCheck(ctx context.Context) error {
	if m.healthCheckFunc != nil {
		return m.healthCheckFunc(ctx)
	}
	return nil
}

// mockModelLister implements the ComfyUIModelLister interface for testing
type mockModelLister struct {
	getModelsFunc func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error)
}

func (m *mockModelLister) GetModels(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
	if m.getModelsFunc != nil {
		return m.getModelsFunc(ctx, modelType)
	}
	return []string{}, nil
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
				mockHealth := &mockHealthChecker{
					healthCheckFunc: func(ctx context.Context) error {
						return nil
					},
				}
				mockModels := &mockModelLister{}

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
				mockHealth := &mockHealthChecker{
					healthCheckFunc: func(ctx context.Context) error {
						return fmt.Errorf("connection refused")
					},
				}
				mockModels := &mockModelLister{}

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
				mockHealth := &mockHealthChecker{}
				mockModels := &mockModelLister{
					getModelsFunc: func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
						Expect(modelType).To(Equal(service.ComfyUIModelTypeVAE))
						return []string{"vae1.safetensors", "vae2.safetensors"}, nil
					},
				}

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				result, err := svc.Models(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Models).To(HaveLen(2))
				Expect(result.Models).To(ContainElements("vae1.safetensors", "vae2.safetensors"))
			})

			It("returns models for CLIP type", func() {
				mockHealth := &mockHealthChecker{}
				mockModels := &mockModelLister{
					getModelsFunc: func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
						Expect(modelType).To(Equal(service.ComfyUIModelTypeCLIP))
						return []string{"clip1.safetensors"}, nil
					},
				}

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "clip"}
				result, err := svc.Models(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Models).To(HaveLen(1))
				Expect(result.Models).To(ContainElement("clip1.safetensors"))
			})

			It("returns empty list when model discovery fails", func() {
				mockHealth := &mockHealthChecker{}
				mockModels := &mockModelLister{
					getModelsFunc: func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
						return nil, fmt.Errorf("network error")
					},
				}

				svc := api.NewComfyUIService(mockHealth, mockModels)
				payload := &gencomfyui.ModelsPayload{Type: "vae"}
				result, err := svc.Models(ctx, payload)

				// Should not return error - just empty list
				Expect(err).NotTo(HaveOccurred())
				Expect(result.Models).To(BeEmpty())
			})
		})

		Context("with different model types", func() {
			DescribeTable("accepts valid model types and passes them through",
				func(modelType string, expectedServiceType service.ComfyUIModelType) {
					mockHealth := &mockHealthChecker{}
					var receivedType service.ComfyUIModelType
					mockModels := &mockModelLister{
						getModelsFunc: func(ctx context.Context, modelType service.ComfyUIModelType) ([]string, error) {
							receivedType = modelType
							return []string{"test-model"}, nil
						},
					}

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
			mockModels := &mockModelLister{}
			svc := api.NewComfyUIService(nil, mockModels)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeFalse())
		})

		It("creates disabled service when model lister is nil", func() {
			mockHealth := &mockHealthChecker{}
			svc := api.NewComfyUIService(mockHealth, nil)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeFalse())
		})

		It("creates enabled service when both dependencies are provided", func() {
			mockHealth := &mockHealthChecker{}
			mockModels := &mockModelLister{}
			svc := api.NewComfyUIService(mockHealth, mockModels)
			result, err := svc.Status(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result.Enabled).To(BeTrue())
		})
	})
})
