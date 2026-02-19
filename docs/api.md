# API Design

## 1) Overview

The backend API is built with **Goa v3**, a design-first framework for Go. The API design DSL in
`/backend/internal/api/design/` is the source of truth for all endpoints, payloads, and responses. This document covers
general approach and patterns rather than enumerating specific endpoints.

## 2) Design-first workflow

### 2.1 Source of truth

The Goa DSL files under `/backend/internal/api/design/` define:
- Service groupings and HTTP paths
- Method signatures (request/response types)
- Error types and HTTP status mappings
- CORS configuration

### 2.2 Code generation

```
backend/internal/api/design/   ← DSL definitions (hand-edited)
        │
        │  `make gen` (goa gen)
        ▼
backend/internal/api/gen/      ← Generated code (DO NOT EDIT)
```

- Generated code includes HTTP transport, encoding/decoding, and OpenAPI specs.
- Regenerate after any design change: `cd backend && make gen`.
- Mock generation (mockery) runs after Goa codegen when interfaces change.

### 2.3 Swagger / OpenAPI

- Swagger UI is hosted at `/docs` (served by the `docs` Goa service).
- The generated `openapi.json` is served alongside the Swagger UI assets.
- The Swagger UI provides interactive API documentation and testing.

### 2.4 Validation

- Use Goa's built in `Format()` directive to require correct formatting for request/response types.

## 3) API structure

### 3.1 Service grouping

The API is organized into Goa services, each mapping to a resource domain:

| Service       | Base Path                  | Purpose                                    |
|---------------|----------------------------|--------------------------------------------|
| health        | /health                    | Health check                               |
| docs          | /docs                      | Swagger UI and OpenAPI spec                |
| training_runs | /api/training-runs         | List and scan training runs                |
| images        | /api/images                | Serve image files from the dataset         |
| presets       | /api/presets               | CRUD for dimension mapping presets         |
| ws            | /api/ws                    | WebSocket for live filesystem updates      |

Each service corresponds to a file in the design package (e.g., `training_runs.go`, `presets.go`).

### 3.2 URL conventions

- Resource collections: plural nouns (e.g., `/api/presets`)
- Individual resources: collection + ID (e.g., `/api/presets/{id}`)
- Actions: sub-paths where RESTful verbs don't suffice (e.g., `/api/training-runs/{id}/scan`)
- Standard HTTP methods: GET (read), POST (create), PUT (update), DELETE (remove)

## 4) Authentication and authorization

None. Checkpoint Sampler is a local-first tool with no authentication. It is intended for use on a trusted LAN.

## 5) Error handling

### 5.1 Error response type

All API errors use the `ErrorWithCode` type:

```
{
  "Code": "STABLE_ERROR_CODE",
  "Message": "Human-readable description"
}
```

- `Code` is a stable string for programmatic consumption by the frontend.
- `Message` is a sanitized, user-facing description.
- No secrets, stack traces, or internal details are exposed in error responses.

### 5.2 HTTP status mapping

Goa maps service errors to HTTP status codes in the design DSL. General conventions:

| Scenario              | HTTP Status | Error Code pattern     |
|-----------------------|-------------|------------------------|
| Validation failure    | 400         | `INVALID_*`            |
| Resource not found    | 404         | `NOT_FOUND`            |
| Path traversal        | 403         | `FORBIDDEN`            |
| Server error          | 500         | `INTERNAL_ERROR`       |

## 6) Key endpoints

### 6.1 Training runs

- `GET /api/training-runs` — List all training runs defined in the config file. Returns name, pattern, and dimension extraction config for each.
- `GET /api/training-runs/{id}/scan` — Scan the filesystem for the specified training run. Returns a list of images with their parsed dimension values, and a list of all discovered dimensions with their unique values.

### 6.2 Image serving

- `GET /api/images/*filepath` — Serve an image file. The `filepath` is relative to the configured dataset root. The backend validates the resolved path stays within the root (rejects traversal). Responses include `Cache-Control: max-age=31536000, immutable` and `Content-Type: image/png`.

### 6.3 Presets

- `GET /api/presets` — List all presets.
- `POST /api/presets` — Create a new preset (name, mapping JSON).
- `PUT /api/presets/{id}` — Update an existing preset.
- `DELETE /api/presets/{id}` — Delete a preset.

### 6.4 WebSocket

- `GET /api/ws` — Upgrade to WebSocket. The backend pushes JSON messages when filesystem changes are detected in the active training run's directories. Message types: `image_added`, `image_removed`, `directory_added`.

## 7) Request/response patterns

### 7.1 List endpoints

- Return arrays of resources.
- Support filtering via query parameters where applicable.

### 7.2 Create/update endpoints

- Accept JSON request bodies.
- Return the created/updated resource.
- Validation errors return 400 with specific error codes.

### 7.3 Scan endpoint

- Returns the full scan result in a single response (dataset is small, ~200 images max).
- No pagination needed.

## 8) CORS

- CORS is configured in the API design DSL.
- Allows requests from the frontend origin.
- Supported methods: GET, POST, PUT, DELETE, OPTIONS.

## 9) Content types

- **JSON** is the primary content type for all API requests and responses.
- **PNG** is the content type for image serving responses.

## 10) Implementation pattern

The Goa-generated transport layer calls into hand-written service implementations:

```
HTTP Request
    │
    ▼
Goa Generated Handler (decode, validate)
    │
    ▼
API Implementation (internal/api/)
    │
    ▼
Service Layer (internal/service/)
    │
    ▼
Store (internal/store/)
    │
    ▼
HTTP Response ◀── Goa Generated Encoder
```

The API implementation files in `internal/api/` adapt between Goa-generated types and the service layer's domain model types.
