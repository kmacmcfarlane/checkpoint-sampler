package service_test

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"

	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
	"github.com/sirupsen/logrus"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
)

var _ = Describe("WorkflowLoader", func() {
	var (
		ctx        context.Context
		loader     *service.WorkflowLoader
		logger     *logrus.Logger
		workflowDir string
	)

	BeforeEach(func() {
		ctx = context.Background()
		logger = logrus.New()
		logger.SetOutput(io.Discard)

		// Create a temporary directory for workflows
		var err error
		workflowDir, err = os.MkdirTemp("", "workflow-test-*")
		Expect(err).NotTo(HaveOccurred())

		loader = service.NewWorkflowLoader(workflowDir, logger)
	})

	AfterEach(func() {
		if workflowDir != "" {
			os.RemoveAll(workflowDir)
		}
	})

	Describe("EnsureWorkflowDir", func() {
		It("creates the workflow directory if it does not exist", func() {
			// Remove the directory first
			os.RemoveAll(workflowDir)

			err := loader.EnsureWorkflowDir()
			Expect(err).NotTo(HaveOccurred())

			// Verify directory exists
			info, err := os.Stat(workflowDir)
			Expect(err).NotTo(HaveOccurred())
			Expect(info.IsDir()).To(BeTrue())
		})

		It("succeeds if directory already exists", func() {
			err := loader.EnsureWorkflowDir()
			Expect(err).NotTo(HaveOccurred())

			// Call again
			err = loader.EnsureWorkflowDir()
			Expect(err).NotTo(HaveOccurred())
		})
	})

	Describe("List", func() {
		Context("when workflow directory does not exist", func() {
			It("returns empty list without error", func() {
				os.RemoveAll(workflowDir)
				loader = service.NewWorkflowLoader(workflowDir, logger)

				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(BeEmpty())
			})
		})

		Context("when workflow directory is empty", func() {
			It("returns empty list", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(BeEmpty())
			})
		})

		Context("with valid workflow files", func() {
			BeforeEach(func() {
				// Create a valid workflow with save_image role
				validWorkflow := map[string]interface{}{
					"1": map[string]interface{}{
						"class_type": "SaveImage",
						"_meta": map[string]interface{}{
							"cs_role": "save_image",
						},
					},
					"2": map[string]interface{}{
						"class_type": "UNETLoader",
						"_meta": map[string]interface{}{
							"cs_role": "unet_loader",
						},
					},
				}
				data, _ := json.Marshal(validWorkflow)
				os.WriteFile(filepath.Join(workflowDir, "test-workflow.json"), data, 0644)
			})

			It("loads and validates workflows", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(HaveLen(1))

				wf := workflows[0]
				Expect(wf.Name).To(Equal("test-workflow.json"))
				Expect(wf.ValidationState).To(Equal(model.ValidationStateValid))
				Expect(wf.Roles).To(HaveKey("save_image"))
				Expect(wf.Roles).To(HaveKey("unet_loader"))
				Expect(wf.Roles["save_image"]).To(ConsistOf("1"))
				Expect(wf.Roles["unet_loader"]).To(ConsistOf("2"))
				Expect(wf.Warnings).To(BeEmpty())
			})
		})

		Context("with invalid workflow (missing save_image)", func() {
			BeforeEach(func() {
				// Create a workflow without save_image role
				invalidWorkflow := map[string]interface{}{
					"1": map[string]interface{}{
						"class_type": "UNETLoader",
						"_meta": map[string]interface{}{
							"cs_role": "unet_loader",
						},
					},
				}
				data, _ := json.Marshal(invalidWorkflow)
				os.WriteFile(filepath.Join(workflowDir, "invalid-workflow.json"), data, 0644)
			})

			It("marks workflow as invalid", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(HaveLen(1))

				wf := workflows[0]
				Expect(wf.Name).To(Equal("invalid-workflow.json"))
				Expect(wf.ValidationState).To(Equal(model.ValidationStateInvalid))
			})
		})

		Context("with unknown cs_role values", func() {
			BeforeEach(func() {
				// Create a workflow with unknown role
				workflow := map[string]interface{}{
					"1": map[string]interface{}{
						"class_type": "SaveImage",
						"_meta": map[string]interface{}{
							"cs_role": "save_image",
						},
					},
					"2": map[string]interface{}{
						"class_type": "CustomNode",
						"_meta": map[string]interface{}{
							"cs_role": "custom_unknown_role",
						},
					},
				}
				data, _ := json.Marshal(workflow)
				os.WriteFile(filepath.Join(workflowDir, "workflow-with-unknown-role.json"), data, 0644)
			})

			It("includes warnings for unknown roles but marks workflow as valid", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(HaveLen(1))

				wf := workflows[0]
				Expect(wf.ValidationState).To(Equal(model.ValidationStateValid))
				Expect(wf.Warnings).NotTo(BeEmpty())
				Expect(wf.Warnings[0]).To(ContainSubstring("unknown cs_role"))
				Expect(wf.Warnings[0]).To(ContainSubstring("custom_unknown_role"))
				Expect(wf.Roles).To(HaveKey("custom_unknown_role"))
			})
		})

		Context("with non-JSON files", func() {
			BeforeEach(func() {
				// Create a non-JSON file
				os.WriteFile(filepath.Join(workflowDir, "readme.txt"), []byte("not json"), 0644)

				// Create a valid workflow
				validWorkflow := map[string]interface{}{
					"1": map[string]interface{}{
						"_meta": map[string]interface{}{"cs_role": "save_image"},
					},
				}
				data, _ := json.Marshal(validWorkflow)
				os.WriteFile(filepath.Join(workflowDir, "valid.json"), data, 0644)
			})

			It("skips non-JSON files", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(HaveLen(1))
				Expect(workflows[0].Name).To(Equal("valid.json"))
			})
		})

		Context("with subdirectories", func() {
			BeforeEach(func() {
				// Create a subdirectory with a workflow
				subdir := filepath.Join(workflowDir, "subdir")
				os.Mkdir(subdir, 0755)
				workflow := map[string]interface{}{
					"1": map[string]interface{}{
						"_meta": map[string]interface{}{"cs_role": "save_image"},
					},
				}
				data, _ := json.Marshal(workflow)
				os.WriteFile(filepath.Join(subdir, "nested.json"), data, 0644)
			})

			It("skips subdirectories", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(BeEmpty())
			})
		})

		Context("with malformed JSON", func() {
			BeforeEach(func() {
				// Create a malformed JSON file
				os.WriteFile(filepath.Join(workflowDir, "malformed.json"), []byte("{not valid json}"), 0644)
			})

			It("skips malformed files and logs warning", func() {
				workflows, err := loader.List(ctx)
				Expect(err).NotTo(HaveOccurred())
				Expect(workflows).To(BeEmpty())
			})
		})
	})

	Describe("Get", func() {
		BeforeEach(func() {
			// Create a test workflow
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"class_type": "SaveImage",
					"_meta": map[string]interface{}{
						"cs_role": "save_image",
					},
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "test.json"), data, 0644)
		})

		It("loads a workflow by name", func() {
			wf, err := loader.Get(ctx, "test.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.Name).To(Equal("test.json"))
			Expect(wf.ValidationState).To(Equal(model.ValidationStateValid))
		})

		It("adds .json extension if not present", func() {
			wf, err := loader.Get(ctx, "test")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.Name).To(Equal("test.json"))
		})

		It("returns error for non-existent workflow", func() {
			_, err := loader.Get(ctx, "nonexistent.json")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("not found"))
		})

		It("rejects path traversal attempts", func() {
			_, err := loader.Get(ctx, "../etc/passwd")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid workflow name"))
		})

		It("rejects paths with slashes", func() {
			_, err := loader.Get(ctx, "subdir/workflow.json")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid workflow name"))
		})

		It("rejects paths with backslashes", func() {
			_, err := loader.Get(ctx, "subdir\\workflow.json")
			Expect(err).To(HaveOccurred())
			Expect(err.Error()).To(ContainSubstring("invalid workflow name"))
		})
	})

	Describe("Role extraction", func() {
		DescribeTable("extracts all known roles",
			func(role string) {
				workflow := map[string]interface{}{
					"1": map[string]interface{}{
						"_meta": map[string]interface{}{"cs_role": "save_image"},
					},
					"2": map[string]interface{}{
						"_meta": map[string]interface{}{"cs_role": role},
					},
				}
				data, _ := json.Marshal(workflow)
				filename := role + ".json"
				os.WriteFile(filepath.Join(workflowDir, filename), data, 0644)

				wf, err := loader.Get(ctx, filename)
				Expect(err).NotTo(HaveOccurred())
				Expect(wf.Roles).To(HaveKey(role))
				// For save_image role, both nodes 1 and 2 have it
				if role == "save_image" {
					Expect(wf.Roles[role]).To(ConsistOf("1", "2"))
				} else {
					Expect(wf.Roles[role]).To(ConsistOf("2"))
				}
				Expect(wf.Warnings).To(BeEmpty())
			},
			Entry("unet_loader", "unet_loader"),
			Entry("clip_loader", "clip_loader"),
			Entry("vae_loader", "vae_loader"),
			Entry("sampler", "sampler"),
			Entry("positive_prompt", "positive_prompt"),
			Entry("negative_prompt", "negative_prompt"),
			Entry("shift", "shift"),
			Entry("latent_image", "latent_image"),
			Entry("save_image", "save_image"),
		)

		It("handles multiple nodes with the same role", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "save_image"},
				},
				"2": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "sampler"},
				},
				"3": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "sampler"},
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "multi-sampler.json"), data, 0644)

			wf, err := loader.Get(ctx, "multi-sampler.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.Roles["sampler"]).To(ConsistOf("2", "3"))
		})

		It("handles nodes without _meta", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "save_image"},
				},
				"2": map[string]interface{}{
					"class_type": "SomeNode",
					// no _meta
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "no-meta.json"), data, 0644)

			wf, err := loader.Get(ctx, "no-meta.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.Roles).To(HaveLen(1))
			Expect(wf.Roles).To(HaveKey("save_image"))
		})

		It("handles _meta without cs_role", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "save_image"},
				},
				"2": map[string]interface{}{
					"_meta": map[string]interface{}{"other_field": "value"},
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "no-role.json"), data, 0644)

			wf, err := loader.Get(ctx, "no-role.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.Roles).To(HaveLen(1))
			Expect(wf.Roles).To(HaveKey("save_image"))
		})

		It("handles empty cs_role", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "save_image"},
				},
				"2": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": ""},
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "empty-role.json"), data, 0644)

			wf, err := loader.Get(ctx, "empty-role.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.Roles).To(HaveLen(1))
			Expect(wf.Roles).To(HaveKey("save_image"))
		})
	})

	Describe("Validation", func() {
		It("validates workflow with only save_image role", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "save_image"},
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "minimal.json"), data, 0644)

			wf, err := loader.Get(ctx, "minimal.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.ValidationState).To(Equal(model.ValidationStateValid))
		})

		It("invalidates workflow without save_image role", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{
					"_meta": map[string]interface{}{"cs_role": "sampler"},
				},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "no-save.json"), data, 0644)

			wf, err := loader.Get(ctx, "no-save.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.ValidationState).To(Equal(model.ValidationStateInvalid))
		})

		It("validates workflow with all roles present", func() {
			workflow := map[string]interface{}{
				"1": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "save_image"}},
				"2": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "unet_loader"}},
				"3": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "clip_loader"}},
				"4": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "vae_loader"}},
				"5": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "sampler"}},
				"6": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "positive_prompt"}},
				"7": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "negative_prompt"}},
				"8": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "shift"}},
				"9": map[string]interface{}{"_meta": map[string]interface{}{"cs_role": "latent_image"}},
			}
			data, _ := json.Marshal(workflow)
			os.WriteFile(filepath.Join(workflowDir, "complete.json"), data, 0644)

			wf, err := loader.Get(ctx, "complete.json")
			Expect(err).NotTo(HaveOccurred())
			Expect(wf.ValidationState).To(Equal(model.ValidationStateValid))
			Expect(wf.Roles).To(HaveLen(9))
		})
	})
})
