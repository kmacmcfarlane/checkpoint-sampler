package service_test

import (
	"context"
	"fmt"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/service"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/store"
)

// mockObjectInfoGetter implements the ObjectInfoGetter interface for testing
type mockObjectInfoGetter struct {
	getObjectInfoFunc func(ctx context.Context, nodeType string) (*store.ObjectInfo, error)
}

func (m *mockObjectInfoGetter) GetObjectInfo(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
	if m.getObjectInfoFunc != nil {
		return m.getObjectInfoFunc(ctx, nodeType)
	}
	return nil, fmt.Errorf("not implemented")
}

var _ = Describe("ComfyUIModelDiscovery", func() {
	var (
		ctx      context.Context
		mockGetter *mockObjectInfoGetter
		discovery  *service.ComfyUIModelDiscovery
	)

	BeforeEach(func() {
		ctx = context.Background()
		mockGetter = &mockObjectInfoGetter{}
		discovery = service.NewComfyUIModelDiscovery(mockGetter)
	})

	Describe("GetModels", func() {
		Context("with VAE model type", func() {
			It("extracts VAE models from VAELoader node", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					Expect(nodeType).To(Equal("VAELoader"))
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"vae_name": {
									[]interface{}{"vae1.safetensors", "vae2.safetensors", "vae3.pt"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(HaveLen(3))
				Expect(models).To(ContainElements("vae1.safetensors", "vae2.safetensors", "vae3.pt"))
			})
		})

		Context("with CLIP model type", func() {
			It("extracts CLIP models from CLIPLoader node", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					Expect(nodeType).To(Equal("CLIPLoader"))
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"clip_name": {
									[]interface{}{"clip1.safetensors", "clip2.safetensors"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeCLIP)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(HaveLen(2))
				Expect(models).To(ContainElements("clip1.safetensors", "clip2.safetensors"))
			})
		})

		Context("with UNET model type", func() {
			It("extracts UNET models from UNETLoader node", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					Expect(nodeType).To(Equal("UNETLoader"))
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"unet_name": {
									[]interface{}{"unet1.safetensors"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeUNET)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(HaveLen(1))
				Expect(models).To(ContainElement("unet1.safetensors"))
			})
		})

		Context("with sampler model type", func() {
			It("extracts samplers from KSampler node", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					Expect(nodeType).To(Equal("KSampler"))
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"sampler_name": {
									[]interface{}{"euler", "euler_ancestral", "dpm_2", "dpm_adaptive"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeSampler)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(HaveLen(4))
				Expect(models).To(ContainElements("euler", "euler_ancestral", "dpm_2", "dpm_adaptive"))
			})
		})

		Context("with scheduler model type", func() {
			It("extracts schedulers from KSampler node", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					Expect(nodeType).To(Equal("KSampler"))
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"scheduler": {
									[]interface{}{"normal", "karras", "exponential", "sgm_uniform"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeScheduler)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(HaveLen(4))
				Expect(models).To(ContainElements("normal", "karras", "exponential", "sgm_uniform"))
			})
		})

		Context("with field in optional inputs", func() {
			It("extracts models from optional section", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{},
							Optional: map[string][]interface{}{
								"vae_name": {
									[]interface{}{"optional_vae.safetensors"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(HaveLen(1))
				Expect(models).To(ContainElement("optional_vae.safetensors"))
			})
		})

		Context("error cases", func() {
			It("returns error for unsupported model type", func() {
				_, err := discovery.GetModels(ctx, service.ComfyUIModelType("unsupported"))
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("unsupported model type"))
			})

			It("returns error when GetObjectInfo fails", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return nil, fmt.Errorf("network error")
				}

				_, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("network error"))
			})

			It("returns error when field not found", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"other_field": {[]interface{}{"value"}},
							},
						},
					}, nil
				}

				_, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("not found"))
			})

			It("returns error for nil object info", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return nil, nil
				}

				_, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("nil object info"))
			})
		})
	})

	Describe("parseInputOptions", func() {
		// Testing via GetModels since parseInputOptions is private

		Context("with valid input spec", func() {
			It("parses array of string choices", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"vae_name": {
									[]interface{}{"model1", "model2", "model3"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(Equal([]string{"model1", "model2", "model3"}))
			})

			It("filters out non-string choices", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"vae_name": {
									[]interface{}{"model1", 123, "model2", nil, "model3"},
								},
							},
						},
					}, nil
				}

				models, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).NotTo(HaveOccurred())
				Expect(models).To(Equal([]string{"model1", "model2", "model3"}))
			})
		})

		Context("with invalid input spec", func() {
			It("returns error for empty input spec", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"vae_name": {},
							},
						},
					}, nil
				}

				_, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("empty input spec"))
			})

			It("returns error when first element is not an array", func() {
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								"vae_name": {
									"not-an-array",
								},
							},
						},
					}, nil
				}

				_, err := discovery.GetModels(ctx, service.ComfyUIModelTypeVAE)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("not an array"))
			})
		})
	})

	Describe("Node type mapping", func() {
		// Test that the correct node types are queried for each model type
		DescribeTable("queries correct node type",
			func(modelType service.ComfyUIModelType, expectedNodeType string) {
				var queriedNodeType string
				mockGetter.getObjectInfoFunc = func(ctx context.Context, nodeType string) (*store.ObjectInfo, error) {
					queriedNodeType = nodeType
					return &store.ObjectInfo{
						Input: store.ObjectInfoInput{
							Required: map[string][]interface{}{
								// Return appropriate field based on node type
								"vae_name":      {[]interface{}{"test"}},
								"clip_name":     {[]interface{}{"test"}},
								"unet_name":     {[]interface{}{"test"}},
								"sampler_name":  {[]interface{}{"test"}},
								"scheduler":     {[]interface{}{"test"}},
							},
						},
					}, nil
				}

				_, err := discovery.GetModels(ctx, modelType)
				Expect(err).NotTo(HaveOccurred())
				Expect(queriedNodeType).To(Equal(expectedNodeType))
			},
			Entry("VAE -> VAELoader", service.ComfyUIModelTypeVAE, "VAELoader"),
			Entry("CLIP -> CLIPLoader", service.ComfyUIModelTypeCLIP, "CLIPLoader"),
			Entry("UNET -> UNETLoader", service.ComfyUIModelTypeUNET, "UNETLoader"),
			Entry("Sampler -> KSampler", service.ComfyUIModelTypeSampler, "KSampler"),
			Entry("Scheduler -> KSampler", service.ComfyUIModelTypeScheduler, "KSampler"),
		)
	})
})
