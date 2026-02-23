package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/config"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}

	// Open database and run migrations
	db, err := store.OpenDB(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("opening database: %w", err)
	}
	st, err := store.New(db)
	if err != nil {
		return fmt.Errorf("initializing store: %w", err)
	}
	defer st.Close()

	// Read the generated OpenAPI spec
	specPath := openAPISpecPath()
	spec, err := os.ReadFile(specPath)
	if err != nil {
		return fmt.Errorf("reading openapi spec at %s: %w", specPath, err)
	}

	// Create filesystem, discovery, and scanner services
	fs := store.NewFileSystem()
	discovery := service.NewDiscoveryService(fs, cfg.CheckpointDirs, cfg.SampleDir)
	scanner := service.NewScanner(fs, cfg.SampleDir)

	// Create WebSocket hub and filesystem watcher
	hub := service.NewHub(log.Default())
	notifier, err := service.NewFSNotifier()
	if err != nil {
		return fmt.Errorf("creating filesystem notifier: %w", err)
	}
	defer notifier.Close()
	watcher := service.NewWatcher(notifier, hub, cfg.SampleDir, log.Default())
	defer watcher.Stop()

	// Create ComfyUI services if configured
	var comfyuiSvc *api.ComfyUIService
	if cfg.ComfyUI != nil {
		httpClient := store.NewComfyUIHTTPClient(cfg.ComfyUI.Host, cfg.ComfyUI.Port)
		modelDiscovery := service.NewComfyUIModelDiscovery(httpClient)
		comfyuiSvc = api.NewComfyUIService(httpClient, modelDiscovery)
	} else {
		// Create disabled service when ComfyUI is not configured
		comfyuiSvc = api.NewComfyUIService(nil, nil)
	}

	// Create service implementations
	healthSvc := api.NewHealthService()
	docsSvc := api.NewDocsService(spec)
	trainingRunsSvc := api.NewTrainingRunsService(discovery, scanner, watcher)
	presetSvc := service.NewPresetService(st)
	presetsSvc := api.NewPresetsService(presetSvc)
	checkpointMetadataSvc := service.NewCheckpointMetadataService(fs, cfg.CheckpointDirs)
	checkpointsSvc := api.NewCheckpointsService(checkpointMetadataSvc)
	imageMetadataSvc := service.NewImageMetadataService(fs, cfg.SampleDir)
	wsSvc := api.NewWSService(hub)

	// Create Goa endpoints
	healthEndpoints := genhealth.NewEndpoints(healthSvc)
	docsEndpoints := gendocs.NewEndpoints(docsSvc)
	trainingRunsEndpoints := gentrainingruns.NewEndpoints(trainingRunsSvc)
	presetsEndpoints := genpresets.NewEndpoints(presetsSvc)
	checkpointsEndpoints := gencheckpoints.NewEndpoints(checkpointsSvc)
	comfyuiEndpoints := gencomfyui.NewEndpoints(comfyuiSvc)
	wsEndpoints := genws.NewEndpoints(wsSvc)

	// Build image handler with metadata support
	imageHandler := api.NewImageHandler(cfg.SampleDir)
	imageHandler.SetMetadataHandler(api.NewImageMetadataHandler(imageMetadataSvc))

	// Build the HTTP handler with all transport setup
	handler := api.NewHTTPHandler(api.HTTPHandlerConfig{
		HealthEndpoints:      healthEndpoints,
		DocsEndpoints:        docsEndpoints,
		TrainingRunEndpoints: trainingRunsEndpoints,
		PresetsEndpoints:     presetsEndpoints,
		CheckpointsEndpoints: checkpointsEndpoints,
		ComfyUIEndpoints:     comfyuiEndpoints,
		WSEndpoints:          wsEndpoints,
		ImageHandler:         imageHandler,
		SwaggerUIDir:         http.Dir(swaggerUIDir()),
		Logger:               log.Default(),
		Debug:                true,
	})

	// Create HTTP server
	addr := net.JoinHostPort(cfg.IPAddress, fmt.Sprintf("%d", cfg.Port))
	srv := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("shutdown error: %v", err)
		}
	}()

	log.Printf("starting server on %s", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}

	return nil
}

// openAPISpecPath returns the path to the generated OpenAPI 3.0 spec.
// In production (Dockerfile), it's at gen/http/openapi3.json.
// In development, it's at internal/api/gen/http/openapi3.json.
func openAPISpecPath() string {
	// Check production path first
	if _, err := os.Stat("gen/http/openapi3.json"); err == nil {
		return "gen/http/openapi3.json"
	}
	return "internal/api/gen/http/openapi3.json"
}

// swaggerUIDir returns the base directory for static file serving.
// In production (Dockerfile), swagger-ui is at public/swagger-ui/.
// In development, it's at internal/api/design/public/swagger-ui/.
func swaggerUIDir() string {
	// Check production path first
	if _, err := os.Stat("public/swagger-ui"); err == nil {
		return "."
	}
	return "internal/api/design"
}
