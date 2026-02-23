package main

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	gensamplepresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_presets"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	genworkflows "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/workflows"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/config"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/service"
	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/store"
	"github.com/sirupsen/logrus"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("fatal: %v", err)
	}
}

func run() error {
	// Initialize logger
	logger := logrus.New()
	logger.SetFormatter(&logrus.TextFormatter{
		FullTimestamp: true,
	})

	// Parse and set log level from environment variable (default: info)
	logLevelStr := os.Getenv("LOG_LEVEL")
	if logLevelStr == "" {
		logLevelStr = "info"
	}
	logLevel, err := logrus.ParseLevel(strings.ToLower(logLevelStr))
	if err != nil {
		logger.WithFields(logrus.Fields{
			"log_level": logLevelStr,
			"error":     err.Error(),
		}).Warn("invalid LOG_LEVEL value, defaulting to info")
		logLevel = logrus.InfoLevel
	}
	logger.SetLevel(logLevel)

	logger.WithField("log_level", logLevel.String()).Info("logger initialized")

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("loading config: %w", err)
	}
	logger.WithField("config_path", os.Getenv("CONFIG_PATH")).Info("configuration loaded")

	// Open database and run migrations
	db, err := store.OpenDB(cfg.DBPath)
	if err != nil {
		return fmt.Errorf("opening database: %w", err)
	}
	logger.WithField("db_path", cfg.DBPath).Info("database opened")
	st, err := store.New(db, logger)
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
	fs := store.NewFileSystem(logger)
	discovery := service.NewDiscoveryService(fs, cfg.CheckpointDirs, cfg.SampleDir, logger)
	scanner := service.NewScanner(fs, cfg.SampleDir, logger)

	// Create WebSocket hub and filesystem watcher
	hub := service.NewHub(logger)
	notifier, err := service.NewFSNotifier()
	if err != nil {
		return fmt.Errorf("creating filesystem notifier: %w", err)
	}
	defer notifier.Close()
	watcher := service.NewWatcher(notifier, hub, cfg.SampleDir, logger)
	defer watcher.Stop()

	// Create ComfyUI services if configured
	var comfyuiSvc *api.ComfyUIService
	var workflowsSvc *api.WorkflowService
	if cfg.ComfyUI != nil {
		httpClient := store.NewComfyUIHTTPClient(cfg.ComfyUI.Host, cfg.ComfyUI.Port, logger)
		modelDiscovery := service.NewComfyUIModelDiscovery(httpClient, logger)
		comfyuiSvc = api.NewComfyUIService(httpClient, modelDiscovery)

		// Create workflow loader and ensure workflow directory exists
		workflowLoader := service.NewWorkflowLoader(cfg.ComfyUI.WorkflowDir, logger)
		if err := workflowLoader.EnsureWorkflowDir(); err != nil {
			return fmt.Errorf("ensuring workflow directory: %w", err)
		}
		workflowsSvc = api.NewWorkflowService(workflowLoader)
	} else {
		// Create disabled service when ComfyUI is not configured
		comfyuiSvc = api.NewComfyUIService(nil, nil)
		// Create a disabled workflow service (nil loader will cause errors if called)
		workflowsSvc = api.NewWorkflowService(nil)
	}

	// Create service implementations
	healthSvc := api.NewHealthService()
	docsSvc := api.NewDocsService(spec)
	trainingRunsSvc := api.NewTrainingRunsService(discovery, scanner, watcher)
	presetSvc := service.NewPresetService(st, logger)
	presetsSvc := api.NewPresetsService(presetSvc)
	samplePresetSvc := service.NewSamplePresetService(st, logger)
	samplePresetsSvc := api.NewSamplePresetsService(samplePresetSvc)
	checkpointMetadataSvc := service.NewCheckpointMetadataService(fs, cfg.CheckpointDirs, logger)
	checkpointsSvc := api.NewCheckpointsService(checkpointMetadataSvc)
	imageMetadataSvc := service.NewImageMetadataService(fs, cfg.SampleDir, logger)
	wsSvc := api.NewWSService(hub)

	// Create Goa endpoints
	healthEndpoints := genhealth.NewEndpoints(healthSvc)
	docsEndpoints := gendocs.NewEndpoints(docsSvc)
	trainingRunsEndpoints := gentrainingruns.NewEndpoints(trainingRunsSvc)
	presetsEndpoints := genpresets.NewEndpoints(presetsSvc)
	samplePresetsEndpoints := gensamplepresets.NewEndpoints(samplePresetsSvc)
	checkpointsEndpoints := gencheckpoints.NewEndpoints(checkpointsSvc)
	comfyuiEndpoints := gencomfyui.NewEndpoints(comfyuiSvc)
	workflowsEndpoints := genworkflows.NewEndpoints(workflowsSvc)
	wsEndpoints := genws.NewEndpoints(wsSvc)

	// Build image handler with metadata support
	imageHandler := api.NewImageHandler(cfg.SampleDir)
	imageHandler.SetMetadataHandler(api.NewImageMetadataHandler(imageMetadataSvc))

	// Build the HTTP handler with all transport setup
	handler := api.NewHTTPHandler(api.HTTPHandlerConfig{
		HealthEndpoints:        healthEndpoints,
		DocsEndpoints:          docsEndpoints,
		TrainingRunEndpoints:   trainingRunsEndpoints,
		PresetsEndpoints:       presetsEndpoints,
		SamplePresetsEndpoints: samplePresetsEndpoints,
		CheckpointsEndpoints:   checkpointsEndpoints,
		ComfyUIEndpoints:       comfyuiEndpoints,
		WorkflowsEndpoints:     workflowsEndpoints,
		WSEndpoints:            wsEndpoints,
		ImageHandler:           imageHandler,
		SwaggerUIDir:           http.Dir(swaggerUIDir()),
		Logger:                 logger,
		Debug:                  true,
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
		logger.Info("shutdown signal received")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			logger.WithError(err).Error("shutdown error")
		}
	}()

	logger.WithField("address", addr).Info("starting server")
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
