package api_test

import (
	"context"
	"fmt"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	genworkflows "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/workflows"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
)

// mockWorkflowLoader implements the WorkflowLoader interface for testing
type mockWorkflowLoader struct {
	listFunc func(ctx context.Context) ([]model.WorkflowTemplate, error)
	getFunc  func(ctx context.Context, name string) (model.WorkflowTemplate, error)
}

func (m *mockWorkflowLoader) List(ctx context.Context) ([]model.WorkflowTemplate, error) {
	if m.listFunc != nil {
		return m.listFunc(ctx)
	}
	return []model.WorkflowTemplate{}, nil
}

func (m *mockWorkflowLoader) Get(ctx context.Context, name string) (model.WorkflowTemplate, error) {
	if m.getFunc != nil {
		return m.getFunc(ctx, name)
	}
	return model.WorkflowTemplate{}, fmt.Errorf("workflow not found: %s", name)
}

var _ = Describe("WorkflowService", func() {
	var (
		ctx context.Context
	)

	BeforeEach(func() {
		ctx = context.Background()
	})

	Describe("List", func() {
		Context("when workflows service is disabled", func() {
			It("returns empty list", func() {
				svc := api.NewWorkflowService(nil)
				result, err := svc.List(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result).To(BeEmpty())
			})
		})

		Context("when workflows service is enabled", func() {
			It("returns workflow summaries from loader", func() {
				mockLoader := &mockWorkflowLoader{
					listFunc: func(ctx context.Context) ([]model.WorkflowTemplate, error) {
						return []model.WorkflowTemplate{
							{
								Name:            "test-workflow-1.json",
								ValidationState: model.ValidationStateValid,
								Roles: map[string][]string{
									"save_image": {"10"},
								},
								Warnings: []string{},
								Workflow: map[string]interface{}{"nodes": "data"},
							},
							{
								Name:            "test-workflow-2.json",
								ValidationState: model.ValidationStateInvalid,
								Roles:           map[string][]string{},
								Warnings:        []string{"missing required save_image role"},
								Workflow:        map[string]interface{}{"nodes": "data2"},
							},
						}, nil
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				result, err := svc.List(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(2))

				// Check first workflow summary
				Expect(result[0].Name).To(Equal("test-workflow-1.json"))
				Expect(result[0].ValidationState).To(Equal("valid"))
				Expect(result[0].Roles).To(HaveKey("save_image"))
				Expect(result[0].Roles["save_image"]).To(Equal([]string{"10"}))
				Expect(result[0].Warnings).To(BeEmpty())

				// Check second workflow summary
				Expect(result[1].Name).To(Equal("test-workflow-2.json"))
				Expect(result[1].ValidationState).To(Equal("invalid"))
				Expect(result[1].Roles).To(BeEmpty())
				Expect(result[1].Warnings).To(HaveLen(1))
				Expect(result[1].Warnings[0]).To(Equal("missing required save_image role"))
			})

			It("returns empty list when no workflows found", func() {
				mockLoader := &mockWorkflowLoader{
					listFunc: func(ctx context.Context) ([]model.WorkflowTemplate, error) {
						return []model.WorkflowTemplate{}, nil
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				result, err := svc.List(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(BeEmpty())
			})

			It("returns error when loader fails", func() {
				mockLoader := &mockWorkflowLoader{
					listFunc: func(ctx context.Context) ([]model.WorkflowTemplate, error) {
						return nil, fmt.Errorf("failed to read directory")
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				result, err := svc.List(ctx)

				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("failed to read directory"))
				Expect(result).To(BeNil())
			})
		})

		Context("mapping from model to Goa types", func() {
			It("correctly maps WorkflowTemplate to WorkflowSummary", func() {
				mockLoader := &mockWorkflowLoader{
					listFunc: func(ctx context.Context) ([]model.WorkflowTemplate, error) {
						return []model.WorkflowTemplate{
							{
								Name:            "mapping-test.json",
								ValidationState: model.ValidationStateValid,
								Roles: map[string][]string{
									"save_image":      {"5"},
									"checkpoint_load": {"1"},
								},
								Warnings: []string{"warning 1", "warning 2"},
								Workflow: map[string]interface{}{
									"1": map[string]interface{}{"class_type": "CheckpointLoaderSimple"},
								},
							},
						}, nil
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				result, err := svc.List(ctx)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).To(HaveLen(1))

				summary := result[0]
				Expect(summary.Name).To(Equal("mapping-test.json"))
				Expect(summary.ValidationState).To(Equal("valid"))
				Expect(summary.Roles).To(HaveLen(2))
				Expect(summary.Roles["save_image"]).To(Equal([]string{"5"}))
				Expect(summary.Roles["checkpoint_load"]).To(Equal([]string{"1"}))
				Expect(summary.Warnings).To(Equal([]string{"warning 1", "warning 2"}))
			})
		})
	})

	Describe("Show", func() {
		Context("when workflows service is disabled", func() {
			It("returns not found error", func() {
				svc := api.NewWorkflowService(nil)
				payload := &genworkflows.ShowPayload{Name: "test-workflow.json"}
				result, err := svc.Show(ctx, payload)

				Expect(err).To(HaveOccurred())
				Expect(result).To(BeNil())

				// Check that error is a not_found ServiceError
				Expect(err.Error()).To(ContainSubstring("workflow not found"))
			})
		})

		Context("when workflows service is enabled", func() {
			It("returns workflow details when found", func() {
				workflowData := map[string]interface{}{
					"1": map[string]interface{}{
						"class_type": "CheckpointLoaderSimple",
						"_meta":      map[string]interface{}{"cs_role": "checkpoint_load"},
					},
					"5": map[string]interface{}{
						"class_type": "SaveImage",
						"_meta":      map[string]interface{}{"cs_role": "save_image"},
					},
				}

				mockLoader := &mockWorkflowLoader{
					getFunc: func(ctx context.Context, name string) (model.WorkflowTemplate, error) {
						Expect(name).To(Equal("test-workflow.json"))
						return model.WorkflowTemplate{
							Name:            "test-workflow.json",
							Path:            "/workflows/test-workflow.json",
							ValidationState: model.ValidationStateValid,
							Roles: map[string][]string{
								"save_image":      {"5"},
								"checkpoint_load": {"1"},
							},
							Warnings: []string{},
							Workflow: workflowData,
						}, nil
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				payload := &genworkflows.ShowPayload{Name: "test-workflow.json"}
				result, err := svc.Show(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result).NotTo(BeNil())
				Expect(result.Name).To(Equal("test-workflow.json"))
				Expect(result.ValidationState).To(Equal("valid"))
				Expect(result.Roles).To(HaveLen(2))
				Expect(result.Warnings).To(BeEmpty())
				Expect(result.Workflow).To(Equal(workflowData))
			})

			It("returns not found error when workflow does not exist", func() {
				mockLoader := &mockWorkflowLoader{
					getFunc: func(ctx context.Context, name string) (model.WorkflowTemplate, error) {
						return model.WorkflowTemplate{}, fmt.Errorf("workflow not found: %s", name)
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				payload := &genworkflows.ShowPayload{Name: "nonexistent.json"}
				result, err := svc.Show(ctx, payload)

				Expect(err).To(HaveOccurred())
				Expect(result).To(BeNil())
				Expect(err.Error()).To(ContainSubstring("workflow not found"))
			})

			It("correctly maps WorkflowTemplate to WorkflowDetails", func() {
				workflowData := map[string]interface{}{
					"10": map[string]interface{}{
						"class_type": "SaveImage",
					},
				}

				mockLoader := &mockWorkflowLoader{
					getFunc: func(ctx context.Context, name string) (model.WorkflowTemplate, error) {
						return model.WorkflowTemplate{
							Name:            "detailed.json",
							Path:            "/workflows/detailed.json",
							ValidationState: model.ValidationStateValid,
							Roles: map[string][]string{
								"save_image": {"10"},
							},
							Warnings: []string{"some warning"},
							Workflow: workflowData,
						}, nil
					},
				}

				svc := api.NewWorkflowService(mockLoader)
				payload := &genworkflows.ShowPayload{Name: "detailed.json"}
				result, err := svc.Show(ctx, payload)

				Expect(err).NotTo(HaveOccurred())
				Expect(result.Name).To(Equal("detailed.json"))
				Expect(result.ValidationState).To(Equal("valid"))
				Expect(result.Roles).To(HaveKey("save_image"))
				Expect(result.Warnings).To(Equal([]string{"some warning"}))
				Expect(result.Workflow).To(Equal(workflowData))
			})
		})
	})

	Describe("Service construction", func() {
		It("creates disabled service when loader is nil", func() {
			svc := api.NewWorkflowService(nil)
			result, err := svc.List(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(BeEmpty())
		})

		It("creates enabled service when loader is provided", func() {
			mockLoader := &mockWorkflowLoader{
				listFunc: func(ctx context.Context) ([]model.WorkflowTemplate, error) {
					return []model.WorkflowTemplate{
						{
							Name:            "test.json",
							ValidationState: model.ValidationStateValid,
							Roles:           map[string][]string{"save_image": {"1"}},
							Warnings:        []string{},
						},
					}, nil
				},
			}

			svc := api.NewWorkflowService(mockLoader)
			result, err := svc.List(ctx)

			Expect(err).NotTo(HaveOccurred())
			Expect(result).To(HaveLen(1))
		})
	})
})
