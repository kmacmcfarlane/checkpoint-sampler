package model

// WorkflowTemplate represents a ComfyUI workflow template with cs_role tags.
type WorkflowTemplate struct {
	Name            string
	Path            string
	Workflow        map[string]interface{}
	Roles           map[string][]string
	ValidationState ValidationState
	Warnings        []string
}

// ValidationState indicates whether a workflow is valid.
type ValidationState string

const (
	ValidationStateValid   ValidationState = "valid"
	ValidationStateInvalid ValidationState = "invalid"
)

// CSRole represents the known cs_role values.
type CSRole string

const (
	CSRoleSaveImage      CSRole = "save_image"
	CSRoleUNETLoader     CSRole = "unet_loader"
	CSRoleCLIPLoader     CSRole = "clip_loader"
	CSRoleVAELoader      CSRole = "vae_loader"
	CSRoleSampler        CSRole = "sampler"
	CSRolePositivePrompt CSRole = "positive_prompt"
	CSRoleNegativePrompt CSRole = "negative_prompt"
	CSRoleShift          CSRole = "shift"
	CSRoleLatentImage    CSRole = "latent_image"
)

// KnownCSRoles returns all known cs_role values.
func KnownCSRoles() []CSRole {
	return []CSRole{
		CSRoleSaveImage,
		CSRoleUNETLoader,
		CSRoleCLIPLoader,
		CSRoleVAELoader,
		CSRoleSampler,
		CSRolePositivePrompt,
		CSRoleNegativePrompt,
		CSRoleShift,
		CSRoleLatentImage,
	}
}

// IsKnownRole checks if a role string is a known cs_role.
func IsKnownRole(role string) bool {
	for _, r := range KnownCSRoles() {
		if string(r) == role {
			return true
		}
	}
	return false
}
