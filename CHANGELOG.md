# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### S-014: WebSocket live updates (backend)
- backend/internal/model/event.go: FSEvent domain type with EventType enum (image_added, image_removed, directory_added) and relative Path field
- backend/internal/service/hub.go: WebSocket Hub managing connected HubClient instances; Register/Unregister clients, Broadcast FSEvents to all clients, auto-remove unresponsive clients
- backend/internal/service/watcher.go: Filesystem Watcher using fsnotify; WatchTrainingRun watches sample directories for active training run checkpoints plus sample_dir root; converts fsnotify events (Create/Remove/Rename) into model.FSEvent broadcasts; auto-watches newly created directories; case-insensitive PNG detection; WatcherNotifier interface for testability
- backend/internal/api/design/ws.go: Goa DSL defining ws service with StreamingResult subscribe method at GET /api/ws; FSEventResponse type with event type and path fields
- backend/internal/api/ws.go: WSService implementing generated ws.Service interface; Subscribe method registers a streamClient with the Hub and blocks until client disconnects; streamClient adapts Goa SubscribeServerStream to HubClient with buffered event channel and write pump goroutine
- backend/internal/api/http.go: Added WSEndpoints to HTTPHandlerConfig; WebSocket upgrader with permissive origin check; mounts generated ws server with gorilla/websocket upgrader
- backend/internal/api/training_runs.go: Scan method now starts filesystem watching for the scanned training run (watcher is optional/nil-safe)
- backend/cmd/server/main.go: Wired Hub, FSNotifier, Watcher, WSService, and ws endpoints into server startup; graceful shutdown closes notifier and stops watcher
- go.mod: Added fsnotify v1.9.0 and gorilla/websocket v1.5.3 as direct dependencies
- 10 Hub unit tests: register/unregister lifecycle, client count tracking, broadcast to all clients, removal of unresponsive clients, multiple events in sequence, no-op on empty hub
- 13 Watcher unit tests: watch directory setup for checkpoints with samples, sample_dir root always watched, previous watch cleanup, image_added/image_removed/directory_added events, auto-watch new directories, non-PNG file ignoring, Write event ignoring, case-insensitive PNG, stop idempotency

### S-013: Image lightbox with zoom and pan
- frontend/src/components/ImageLightbox.vue: Modal overlay component with full-size image display, mouse wheel zoom (toward cursor position), click-drag pan, Escape key and backdrop click to close, grab/grabbing cursor states, transform reset on image change
- frontend/src/components/ImageCell.vue: Added click emit that fires with image URL when an image is present; cursor: pointer style on images
- frontend/src/components/XYGrid.vue: Added image:click emit forwarding ImageCell click events to parent for all grid layouts (x+y, x-only, y-only, flat)
- frontend/src/App.vue: Integrated ImageLightbox with lightbox state management; XYGrid image clicks open the lightbox, Escape/backdrop closes it
- 13 ImageLightbox unit tests: dialog rendering, backdrop close, content area non-close, Escape close, non-Escape ignore, zoom in/out via wheel, mouse drag pan, grab cursor states, transform reset on prop change, non-draggable image, event listener cleanup on unmount, right-click drag ignore

### R-001: Refactor Goa HTTP wireup into NewHTTPHandler
- backend/internal/api/http.go: New file with NewHTTPHandler() that encapsulates all Goa HTTP transport setup (mux creation, decoder/encoder, server instantiation, mounting, middleware application, custom handlers)
- backend/internal/api/http.go: HTTPHandlerConfig struct takes pre-built Goa endpoints, ImageHandler, SwaggerUIDir, Logger, and Debug flag
- backend/internal/api/http.go: errorHandler helper logs encoding errors with request ID for correlation
- backend/internal/api/http.go: HTTP-level middleware (RequestID, CORS) applied inside NewHTTPHandler
- backend/internal/api/http.go: Custom image handler and /docs redirect mounted inside NewHTTPHandler
- backend/internal/api/http.go: Debug mode enables error handler and mount logging
- backend/cmd/server/main.go: Simplified to only own dependency injection (config, stores, services, API impls, endpoint creation); calls NewHTTPHandler and wires result into http.Server
- All existing tests pass unchanged (126 specs across 4 suites)

### B-003: Dimension UI selection
- frontend/src/api/types.ts: Changed DimensionRole from 'combo' to 'none' — unassigned dimensions now have 'none' role instead of 'combo' since combo filters are always visible
- frontend/src/components/DimensionPanel.vue: Renamed role label from "Combo Filter" to "None"; default role changed to 'none'
- frontend/src/composables/useDimensionMapping.ts: Default dimension role is now 'none'; displaced dimensions move to 'none'; removed comboDimensions computed (no longer needed since all dimensions show combo filters)
- frontend/src/App.vue: ComboFilter components now render for ALL dimensions regardless of role (not just combo-role ones); preset loading maps combos to 'none' role
- frontend/src/components/PresetSelector.vue: assignmentsToMapping maps 'none' role to combos list for backward-compatible preset serialization
- No backend changes needed — preset mapping combos field naturally stores unassigned ('none' role) dimensions

### B-002: No config.yaml content
- Created `.env` with local host paths for checkpoint and sample directories (gitignored)
- Updated README.md Configuration section with step-by-step setup instructions for `.env` and `config.yaml`

### B-001: WAL mode fails with read-only dev volume
- docker-compose.dev.yml: Use separate `backend_dev_data` named volume for `/build/data` instead of sharing `backend_data` with production mode; the production Dockerfile creates `/app/data` as root with 755 permissions, so when the shared volume was initialized by production first and reused in dev mode (which runs as non-root), SQLite WAL PRAGMA failed with "attempt to write a readonly database"

### S-018: Auto-discover training runs from checkpoint files
- backend/internal/config/config.go: Switched from TOML to YAML configuration (config.yaml); new yamlConfig struct with checkpoint_dirs (list of strings), sample_dir (string), port, ip_address, db_path; validates checkpoint_dirs and sample_dir exist as directories
- config.yaml.example: Example YAML config file with documentation; config.yaml gitignored for local use
- backend/internal/model/config.go: Replaced TrainingRunConfig/DimensionConfig with simplified Config struct (CheckpointDirs, SampleDir); removed pattern/dimensions/root fields
- backend/internal/model/training_run.go: New TrainingRun and Checkpoint domain types for auto-discovered training runs (name, checkpoints, has_samples, step_number, filename, checkpoint_dir_index)
- backend/internal/store/filesystem.go: Replaced ListDirectories with ListSafetensorsFiles (recursive .safetensors scanning) and DirectoryExists; kept ListPNGFiles
- backend/internal/service/discovery.go: New DiscoveryService that recursively scans checkpoint_dirs for .safetensors files, strips suffixes (-step<NNNNN>, -<NNNNNN> epoch), groups into training runs by base name, correlates checkpoints with sample directories under sample_dir, extracts step/epoch numbers, assigns final checkpoint step values
- backend/internal/service/scanner.go: Rewritten to use ScannerFileSystem (ListPNGFiles only); ScanTrainingRun takes model.TrainingRun, scans sample directories per checkpoint, auto-adds "checkpoint" dimension from step numbers, relative paths as checkpoint_filename/image_filename
- backend/internal/api/design/training_runs.go: List method accepts has_samples boolean filter; TrainingRunResponse now includes checkpoint_count, has_samples, checkpoints array; new CheckpointResponse type; removed DimensionConfigResponse and pattern field; added discovery_failed error
- backend/internal/api/training_runs.go: Uses DiscoveryService and Scanner; List calls Discover() with has_samples filter; Scan discovers then scans training run
- backend/cmd/server/main.go: Wired DiscoveryService, updated Scanner and ImageHandler to use sampleDir
- docker-compose.yml, docker-compose.dev.yml: Updated from config.toml to config.yaml; replaced DATASET_ROOT with CHECKPOINT_DIR and SAMPLE_DIR separate volume mounts
- .env.example: Updated from DATASET_ROOT to CHECKPOINT_DIR and SAMPLE_DIR
- frontend/src/api/types.ts: Replaced DimensionConfig with CheckpointInfo; TrainingRun now has checkpoint_count, has_samples, checkpoints instead of pattern/dimensions
- frontend/src/api/client.ts: getTrainingRuns accepts optional hasSamples filter parameter
- frontend/src/components/TrainingRunSelector.vue: Added default-checked "Has samples" filter checkbox; re-fetches training runs when filter changes; resets selection on filter toggle
- 22 discovery service unit tests: suffix stripping (step/epoch), grouping, step extraction, sample correlation, multiple checkpoint dirs, empty dirs, ordering, path preservation, filename-only sample matching
- 16 scanner unit tests: query-encoded filename parsing with checkpoint dimension, checkpoint dimension discovery, skipping checkpoints without samples, batch deduplication, dimension type inference, sorting, error handling, edge cases
- 14 API unit tests: List with has_samples filter, checkpoint details in response, Scan with discovery-based lookup, model-to-API type mapping, error handling
- 5 has-samples filter frontend unit tests: checkbox default state, initial API call with has_samples=true, re-fetch on toggle, selection reset on filter change

### S-012: Preset save and select
- backend/internal/model/preset.go: Preset and PresetMapping domain types (ID, Name, Mapping with X/Y/Slider/Combos, timestamps)
- backend/internal/store/preset.go: PresetStore CRUD operations (ListPresets, GetPreset, CreatePreset, UpdatePreset, DeletePreset) with JSON mapping serialization, RFC3339 timestamps, and sql.ErrNoRows for not-found cases
- backend/internal/service/preset.go: PresetService business logic with UUID generation, name validation, and store delegation
- backend/internal/api/design/presets.go: Goa DSL defining presets service with list, create, update, delete methods; PresetResponse, PresetMappingResponse, CreatePresetPayload, UpdatePresetPayload types
- backend/internal/api/presets.go: PresetsService API implementation mapping between Goa generated types and domain model, wired to service layer
- backend/cmd/server/main.go: Wired presets service, endpoints, and HTTP server into application startup
- frontend/src/api/types.ts: Added Preset and PresetMapping types
- frontend/src/api/client.ts: Added getPresets, createPreset, updatePreset, deletePreset methods
- frontend/src/components/PresetSelector.vue: Component with preset dropdown, save button (prompts for name), delete button, load with unmatched dimension warnings, accessible labels
- frontend/src/App.vue: Integrated PresetSelector with dimension assignment loading, preset warning display, save/delete handlers
- 10 store unit tests: CRUD operations, empty list, ordered by name, duplicate ID rejection, not-found handling, optional mapping fields
- 10 service unit tests: list empty/populated, create with UUID/validation, update with not-found/validation, delete with not-found
- 8 API unit tests: list empty/populated with response mapping, create with payload mapping, update with not-found, delete
- 11 PresetSelector component unit tests: rendering, loading state, error display, load/save/delete events, unmatched dimension warnings, accessible labels, prompt cancellation, disabled save button
- 6 API client unit tests: getPresets, createPreset, updatePreset, deletePreset success and failure

### S-011: Slider navigation
- frontend/src/components/SliderBar.vue: Per-cell range slider component cycling through ordered slider-dimension values, with accessible aria-label and aria-valuetext, current value display
- frontend/src/components/MasterSlider.vue: Top-level master slider that moves all individual cell sliders in sync, with dimension name label and accessible role="group" container
- frontend/src/components/XYGrid.vue: Integrated SliderBar below each ImageCell when a slider dimension is assigned; emits update:sliderValue events for per-cell slider changes; accepts defaultSliderValue prop for master slider synchronization
- frontend/src/composables/useImagePreloader.ts: Composable that preloads images via Image() objects to populate browser HTTP cache; priority 1: all slider positions for visible grid cells, priority 2: remaining filtered images, priority 3: all scan images; cancels in-flight preloads on reset; deduplicates URLs
- frontend/src/App.vue: Integrated MasterSlider above the grid, wired master/individual slider value synchronization (master clears per-cell overrides), added useImagePreloader for background pre-caching, added watch to reset slider state on dimension change
- 10 SliderBar unit tests: range input rendering, min/max bounds, current value index, unknown value fallback, value text display, change emission at various indices, accessible aria-label and aria-valuetext
- 11 MasterSlider unit tests: range input rendering, dimension name label, min/max bounds, current value index, unknown value fallback, value text display, change emission, accessible aria-label, aria-valuetext, role="group" container
- 8 useImagePreloader unit tests: preload all images without slider, prioritize slider positions for visible cells, Image() constructor usage, combo filter integration, restart on image change, empty list handling, URL deduplication, x/y dimension visible cell preloading
- 3 new XYGrid slider integration tests: SliderBar per cell rendering, update:sliderValue emission, no slider when dimension unassigned

### S-010: Combo filters
- frontend/src/components/ComboFilter.vue: Multi-select filter component for combo-assigned dimensions with checkboxes for each value, click-label single-selection shortcut, select-all/select-none controls, and accessible labels
- frontend/src/App.vue: Integrated ComboFilter components for each combo-assigned dimension, wired combo selection updates to reactive state that drives XYGrid filtering
- 16 ComboFilter unit tests: dimension name rendering, checkbox per value, checked state from selection, toggle via checkbox change, add via checkbox, single-select via label click, select-all button, select-none button, All button disabled when all selected, None button disabled when none selected, button enabled states, accessible labels on controls and values, empty values list

### S-009: X/Y grid with dimension mapping
- frontend/src/api/types.ts: Added ScanImage, ScanDimension, ScanResult, DimensionRole, and DimensionAssignment types for scan API responses and dimension mapping state
- frontend/src/api/client.ts: Added scanTrainingRun(id) method to ApiClient for GET /api/training-runs/{id}/scan
- frontend/src/composables/useDimensionMapping.ts: Composable managing dimension-to-role assignments (x, y, slider, combo) with role uniqueness enforcement, computed role accessors, and image lookup
- frontend/src/components/DimensionPanel.vue: Panel listing all discovered dimensions with role selection dropdowns (X Axis, Y Axis, Slider, Combo Filter) and accessible labels
- frontend/src/components/ImageCell.vue: Grid cell component displaying an image via /api/images/ endpoint or a placeholder for missing combinations, with lazy loading
- frontend/src/components/XYGrid.vue: Grid component rendering rows (Y values) and columns (X values) with image lookup, combo filter integration, slider dimension support, horizontal/vertical scrolling, and flat image display when no axes are assigned
- frontend/src/App.vue: Integrated DimensionPanel and XYGrid; training run selection triggers scan API call, populates dimensions and images, initializes combo selections
- 16 composable unit tests: setScanResult initialization, role assignment with displacement, computed dimensions by role, dimensionAssignments array, findImage with exact/partial/missing matches
- 8 DimensionPanel unit tests: row rendering, dimension names, value counts, role options, current assignment display, assign event emission, empty state, accessibility
- 5 ImageCell unit tests: image rendering with URL, placeholder for null, empty class toggling, lazy loading attribute
- 17 XYGrid unit tests: grid structure (headers, rows, cells), image rendering, missing combination placeholders, X-only and Y-only layouts, no-axes empty/flat states, combo filter integration, slider dimension filtering, scrollable container
- 2 API client unit tests: scanTrainingRun success and failure

### S-008: Filesystem scanning and image serving (backend)
- backend/internal/model/scan.go: Domain types for Image (relative path + dimensions map), Dimension (name, type, sorted values), and ScanResult
- backend/internal/service/scanner.go: Scanner service implementing filesystem scanning, query-encoded filename parsing, batch counter deduplication (highest batch number wins), directory dimension regex extraction, dimension type inference (numeric values → int sort), and deterministic output ordering
- backend/internal/store/filesystem.go: FileSystem store providing ListDirectories (recursive walk with regex pattern matching) and ListPNGFiles (directory listing filtered to .png)
- backend/internal/api/design/training_runs.go: Extended Goa DSL with scan method (GET /api/training-runs/{id}/scan), ScanResultResponse, ImageResponse, and DimensionResponse types; not_found and scan_failed error responses
- backend/internal/api/training_runs.go: Updated TrainingRunsService with Scan method that delegates to Scanner, maps model types to API response types, validates training run ID bounds
- backend/internal/api/images.go: ImageHandler serving images from dataset root via GET /api/images/{filepath} with path traversal protection (component validation + resolved path prefix check), Cache-Control: max-age=31536000, immutable headers, and Content-Type: image/png
- backend/cmd/server/main.go: Wired FileSystem store, Scanner service, and ImageHandler into server startup
- 16 service unit tests: filename parsing, batch deduplication, directory dimension extraction, dimension type inference, numeric/string sorting, deterministic ordering, error handling, edge cases
- 6 API unit tests: Scan method (not_found, scan_failed, success with model-to-API mapping), List method compatibility
- 7 integration tests: GET /api/training-runs/{id}/scan (200 with results, 404 for invalid ID), GET /api/images/* (serving, cache headers, 404, path traversal rejection, empty path, directory rejection)

### S-007: Training run listing and selection
- backend/internal/api/design/training_runs.go: Goa DSL for training_runs service with list method returning TrainingRunResponse and DimensionConfigResponse types
- backend/internal/api/gen/training_runs/: Generated Goa code for training_runs service
- backend/internal/api/training_runs.go: TrainingRunsService implementation mapping config training runs to API response types
- backend/cmd/server/main.go: Wired training_runs service into server startup
- frontend/src/api/types.ts: Added TrainingRun and DimensionConfig types
- frontend/src/api/client.ts: Added getTrainingRuns() method
- frontend/src/components/TrainingRunSelector.vue: Dropdown component that fetches and displays training runs, emits selection events, shows loading/error states
- frontend/src/App.vue: Integrated TrainingRunSelector into header, stores selected training run in app state
- 6 backend unit tests: TrainingRunsService list (empty, with runs, with dimensions, empty dimensions) and HTTP integration (GET /api/training-runs response, CORS headers)
- 8 frontend unit tests: TrainingRunSelector (rendering, loading state, dropdown population, selection emit, error display, disabled state) and API client getTrainingRuns method

### S-006: Docker Compose and Makefile wiring
- config.toml: production config with ip_address=0.0.0.0 for LAN access, dataset root at /data/dataset (Docker mount point), db_path at ./data/checkpoint-sampler.db
- docker-compose.yml: dataset root mounted as read-only volume via DATASET_ROOT env var, SQLite data as named Docker volume, config.toml mounted read-only, CONFIG_PATH set
- docker-compose.dev.yml: dataset root and config.toml mounted into dev backend, named volume for data directory, CONFIG_PATH set for dev working directory
- backend/Dockerfile.dev: added /build/data directory with world-writable permissions for named volume compatibility with non-root user
- frontend/nginx.conf: reverse proxy for /api/, /health, and /docs to backend service using Docker embedded DNS resolver for dynamic upstream resolution
- frontend/vite.config.ts: dev proxy for /api, /health, and /docs to backend service for HMR dev mode
- .env.example: documents DATASET_ROOT environment variable
- .gitignore: added .dataset-placeholder/ entry
- Both make up (production) and make up-dev (hot-reload) build and start successfully; frontend proxies API requests to backend in both modes

### S-005: Frontend scaffold and API client
- frontend/src/main.ts: Vue 3 app entry point mounting App component to #app
- frontend/src/App.vue: App shell with header ("Checkpoint Sampler") and placeholder main content
- frontend/src/env.d.ts: TypeScript shims for .vue single-file components and Vite client types
- frontend/src/api/types.ts: Shared API types (ApiErrorResponse, ApiError, HealthStatus)
- frontend/src/api/client.ts: ApiClient class with typed fetch wrapper, error normalization (backend ErrorWithCode → ApiError), NETWORK_ERROR/UNKNOWN_ERROR fallbacks, and getHealth() method; exports singleton apiClient instance
- frontend/index.html: updated title to "Checkpoint Sampler"
- 12 unit tests: ApiClient request method (URL construction, RequestInit passthrough, default base URL, error code parsing, non-JSON error fallback, malformed error body, network errors), getHealth method, and App component rendering

### S-004: Goa API scaffold and codegen pipeline
- backend/internal/api/design/api.go: Goa v3 API definition (title, version, server)
- backend/internal/api/design/health.go: Health check service DSL with GET /health endpoint returning status
- backend/internal/api/design/docs.go: Docs service DSL with GET /docs/openapi3.json and Swagger UI file serving at /docs/
- backend/internal/api/generate.go: go:generate directive for Goa codegen
- backend/internal/api/gen/: Generated Goa code (HTTP transport, encoders, OpenAPI 3.0 spec)
- backend/internal/api/health.go: HealthService implementation returning {"status":"ok"}
- backend/internal/api/docs.go: DocsService implementation serving OpenAPI spec bytes
- backend/internal/api/cors.go: CORS middleware supporting configurable allowed origin
- backend/internal/api/design/public/swagger-ui/: Swagger UI static assets (v5.18.2)
- backend/cmd/server/main.go: Server entrypoint wiring config, database, Goa services, CORS middleware, and graceful shutdown
- 10 unit tests covering health service, docs service, CORS middleware, and HTTP integration (health endpoint, OpenAPI spec, CORS preflight)

### S-003: SQLite database setup and migrations
- backend/internal/store/db.go: OpenDB() configures SQLite with WAL mode, 5s busy timeout, foreign keys ON; creates parent directory if needed
- backend/internal/store/db.go: Migrate() forward-only migration runner with schema_migrations tracking table; applies pending migrations in order within transactions
- backend/internal/store/migrations.go: AllMigrations() returns ordered migration list; migration 1 creates presets table (id, name, mapping JSON, created_at, updated_at)
- backend/internal/store/store.go: Store type with New() constructor that runs migrations on init, Close(), and DB() accessor
- docker-compose.dev.yml: added GOMODCACHE volume for writable Go module cache in dev containers
- 16 unit tests covering DB pragma verification, migration execution, idempotency, error handling, presets table schema validation, and store initialization

### S-002: TOML configuration loading
- backend/internal/model/config.go: domain types for Config, TrainingRunConfig, DimensionConfig, DimensionType
- backend/internal/config/config.go: TOML config loading with Load(), LoadFromPath(), LoadFromString(); validation for root (must exist as directory), port (1-65535, default 8080), ip_address (valid IP, default 127.0.0.1), db_path (default ./data/), training run patterns and dimensions
- Validation rejects missing root, nonexistent root, non-directory root, invalid port, invalid IP, invalid regex patterns, missing required fields, invalid dimension types
- 23 unit tests covering valid config, defaults, missing fields, invalid regex, file loading, and env var override

### S-001: Architecture and schema documentation
- docs/architecture.md: system overview, backend layered structure, filesystem scanning, image serving, WebSocket, frontend architecture, Docker runtime, data flow
- docs/database.md: SQLite setup, migration strategy, presets table schema with mapping JSON format, indexes, conventions
- docs/api.md: Goa design-first workflow, service groupings, endpoint documentation (training runs, images, presets, WebSocket), error handling, CORS
- CLAUDE.md section 5: references SQLite + TOML config + filesystem dataset root
