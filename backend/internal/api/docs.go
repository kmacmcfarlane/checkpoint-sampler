package api

import (
	"context"
)

// DocsService implements the generated docs service interface.
type DocsService struct {
	spec []byte
}

// NewDocsService returns a new DocsService that serves the given OpenAPI spec.
func NewDocsService(spec []byte) *DocsService {
	return &DocsService{spec: spec}
}

// Openapi returns the OpenAPI 3.0 spec as bytes.
func (s *DocsService) Openapi(ctx context.Context) ([]byte, error) {
	return s.spec, nil
}
