package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// WorkflowLoader loads and validates ComfyUI workflow templates.
type WorkflowLoader struct {
	workflowDir string
	logger      *logrus.Entry
}

// NewWorkflowLoader creates a new workflow loader service.
func NewWorkflowLoader(workflowDir string, logger *logrus.Logger) *WorkflowLoader {
	return &WorkflowLoader{
		workflowDir: workflowDir,
		logger:      logger.WithField("component", "workflow_loader"),
	}
}

// List returns all workflow templates found in the workflow directory.
func (l *WorkflowLoader) List(ctx context.Context) ([]model.WorkflowTemplate, error) {
	l.logger.Trace("entering List")
	defer l.logger.Trace("returning from List")

	entries, err := os.ReadDir(l.workflowDir)
	if err != nil {
		if os.IsNotExist(err) {
			l.logger.WithField("workflow_dir", l.workflowDir).Debug("workflow directory does not exist, returning empty list")
			return []model.WorkflowTemplate{}, nil
		}
		l.logger.WithFields(logrus.Fields{
			"workflow_dir": l.workflowDir,
			"error":        err.Error(),
		}).Error("failed to read workflow directory")
		return nil, fmt.Errorf("reading workflow directory: %w", err)
	}

	var workflows []model.WorkflowTemplate
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}

		path := filepath.Join(l.workflowDir, entry.Name())
		workflow, err := l.loadWorkflow(ctx, path)
		if err != nil {
			l.logger.WithFields(logrus.Fields{
				"file":  entry.Name(),
				"error": err.Error(),
			}).Warn("failed to load workflow file, skipping")
			continue
		}
		workflows = append(workflows, workflow)
	}

	l.logger.WithField("workflow_count", len(workflows)).Debug("workflows loaded")
	return workflows, nil
}

// Get returns a single workflow template by name.
func (l *WorkflowLoader) Get(ctx context.Context, name string) (model.WorkflowTemplate, error) {
	l.logger.WithField("name", name).Trace("entering Get")
	defer l.logger.Trace("returning from Get")

	// Sanitize the name to prevent path traversal
	if strings.Contains(name, "..") || strings.Contains(name, "/") || strings.Contains(name, "\\") {
		l.logger.WithField("name", name).Warn("invalid workflow name")
		return model.WorkflowTemplate{}, fmt.Errorf("invalid workflow name: %s", name)
	}

	if !strings.HasSuffix(name, ".json") {
		name = name + ".json"
	}

	path := filepath.Join(l.workflowDir, name)
	workflow, err := l.loadWorkflow(ctx, path)
	if err != nil {
		// Check if the underlying error is a not found error
		if os.IsNotExist(err) || strings.Contains(err.Error(), "no such file") {
			l.logger.WithField("name", name).Debug("workflow not found")
			return model.WorkflowTemplate{}, fmt.Errorf("workflow not found: %s", name)
		}
		l.logger.WithFields(logrus.Fields{
			"name":  name,
			"error": err.Error(),
		}).Error("failed to load workflow")
		return model.WorkflowTemplate{}, fmt.Errorf("loading workflow: %w", err)
	}

	return workflow, nil
}

// loadWorkflow loads and validates a workflow from a file path.
func (l *WorkflowLoader) loadWorkflow(ctx context.Context, path string) (model.WorkflowTemplate, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return model.WorkflowTemplate{}, fmt.Errorf("reading workflow file: %w", err)
	}

	var workflow map[string]interface{}
	if err := json.Unmarshal(data, &workflow); err != nil {
		return model.WorkflowTemplate{}, fmt.Errorf("parsing workflow JSON: %w", err)
	}

	name := filepath.Base(path)
	template := model.WorkflowTemplate{
		Name:     name,
		Path:     path,
		Workflow: workflow,
		Roles:    make(map[string][]string),
		Warnings: []string{},
	}

	// Extract and validate cs_role tags
	l.extractRoles(&template)
	l.validate(&template)

	return template, nil
}

// extractRoles extracts cs_role tags from workflow nodes.
func (l *WorkflowLoader) extractRoles(template *model.WorkflowTemplate) {
	for nodeID, nodeData := range template.Workflow {
		nodeMap, ok := nodeData.(map[string]interface{})
		if !ok {
			continue
		}

		meta, ok := nodeMap["_meta"].(map[string]interface{})
		if !ok {
			continue
		}

		role, ok := meta["cs_role"].(string)
		if !ok || role == "" {
			continue
		}

		// Record the role and node ID
		template.Roles[role] = append(template.Roles[role], nodeID)

		// Check if it's a known role
		if !model.IsKnownRole(role) {
			warning := fmt.Sprintf("unknown cs_role %q on node %s", role, nodeID)
			template.Warnings = append(template.Warnings, warning)
			l.logger.WithFields(logrus.Fields{
				"workflow": template.Name,
				"node_id":  nodeID,
				"cs_role":  role,
			}).Warn("unknown cs_role value")
		}
	}

	l.logger.WithFields(logrus.Fields{
		"workflow":   template.Name,
		"role_count": len(template.Roles),
	}).Debug("roles extracted from workflow")
}

// validate checks workflow requirements.
func (l *WorkflowLoader) validate(template *model.WorkflowTemplate) {
	// Required: save_image role must be present
	if _, ok := template.Roles[string(model.CSRoleSaveImage)]; !ok {
		template.ValidationState = model.ValidationStateInvalid
		l.logger.WithField("workflow", template.Name).Warn("workflow missing required save_image role")
		return
	}

	template.ValidationState = model.ValidationStateValid
	l.logger.WithField("workflow", template.Name).Debug("workflow validated successfully")
}

// EnsureWorkflowDir creates the workflow directory if it does not exist.
func (l *WorkflowLoader) EnsureWorkflowDir() error {
	l.logger.WithField("workflow_dir", l.workflowDir).Trace("entering EnsureWorkflowDir")
	defer l.logger.Trace("returning from EnsureWorkflowDir")

	if err := os.MkdirAll(l.workflowDir, 0755); err != nil {
		l.logger.WithFields(logrus.Fields{
			"workflow_dir": l.workflowDir,
			"error":        err.Error(),
		}).Error("failed to create workflow directory")
		return fmt.Errorf("creating workflow directory: %w", err)
	}

	l.logger.WithField("workflow_dir", l.workflowDir).Info("workflow directory ensured")
	return nil
}
