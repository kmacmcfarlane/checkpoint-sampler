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
	genbasemodels "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/base_models"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	gendemo "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/demo"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	gensamplejobs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_jobs"
	genstudies "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/studies"
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
	discovery := service.NewDiscoveryService(fs, cfg.CheckpointDirs, cfg.LoraDirs, cfg.SampleDir, logger)
	viewerDiscovery := service.NewViewerDiscoveryService(fs, cfg.SampleDir, logger)

	// Determine thumbnail settings
	thumbnailsEnabled := cfg.Thumbnails != nil && cfg.Thumbnails.Enabled
	scanner := service.NewScannerWithThumbnails(fs, cfg.SampleDir, thumbnailsEnabled, logger)

	// Create WebSocket hub and filesystem watcher
	hub := service.NewHub(logger)
	notifier, err := service.NewFSNotifier()
	if err != nil {
		return fmt.Errorf("creating filesystem notifier: %w", err)
	}
	defer notifier.Close()
	watcher := service.NewWatcher(notifier, hub, cfg.SampleDir, logger)
	// watcher.Stop() is called explicitly in performShutdown (before HTTP drain).

	// Create ComfyUI services if configured
	var comfyuiSvc *api.ComfyUIService
	var workflowsSvc *api.WorkflowService
	var modelDiscovery *service.ComfyUIModelDiscovery
	var jobExecutor *service.JobExecutor
	var workflowLoader *service.WorkflowLoader
	var bgPauser api.BackgroundPauser // remains nil (interface nil) when ComfyUI is not configured
	if cfg.ComfyUI != nil {
		httpClient := store.NewComfyUIHTTPClient(cfg.ComfyUI.URL, logger)
		wsClient := store.NewComfyUIWSClient(cfg.ComfyUI.URL, logger)
		modelDiscovery = service.NewComfyUIModelDiscovery(httpClient, logger)
		comfyuiSvc = api.NewComfyUIService(httpClient, modelDiscovery)

		// Create workflow loader and ensure workflow directory exists
		workflowLoader = service.NewWorkflowLoader(cfg.ComfyUI.WorkflowDir, logger)
		if err := workflowLoader.EnsureWorkflowDir(); err != nil {
			return fmt.Errorf("ensuring workflow directory: %w", err)
		}
		workflowsSvc = api.NewWorkflowService(workflowLoader)

		// Create job executor (with optional thumbnail generator)
		fsWriter := &service.RealFileSystemWriter{}
		var thumbGen *service.ThumbnailGenerator
		if cfg.Thumbnails != nil && cfg.Thumbnails.Enabled {
			thumbGen = service.NewThumbnailGenerator(*cfg.Thumbnails, logger)
		}
		reconnectInterval := time.Duration(cfg.ComfyUI.ReconnectInterval) * time.Second
		jobExecutor = service.NewJobExecutorWithThumbnails(st, httpClient, wsClient, workflowLoader, hub, cfg.SampleDir, fsWriter, fs, thumbGen, reconnectInterval, logger)
		bgPauser = jobExecutor
	} else {
		// Create disabled service when ComfyUI is not configured
		comfyuiSvc = api.NewComfyUIService(nil, nil)
		// Create a disabled workflow service (nil loader will cause errors if called)
		workflowsSvc = api.NewWorkflowService(nil)
	}

	// Create and populate the in-memory filesystem state snapshot. This caches
	// training run discovery results so that selector API endpoints serve from
	// memory instead of rescanning the filesystem on every request.
	fsState := service.NewFSState(discovery, viewerDiscovery, logger)
	if err := fsState.Populate(); err != nil {
		logger.WithError(err).Warn("initial FSState population failed, selectors will use empty snapshot until first filesystem event")
	}

	// Start reactive filesystem watching for the snapshot. A separate fsnotify
	// watcher monitors checkpoint_dirs and sample_dir for structural changes
	// (new/removed directories) and triggers snapshot refreshes with debouncing.
	fsStateNotifier, err := service.NewFSNotifier()
	if err != nil {
		return fmt.Errorf("creating FSState filesystem notifier: %w", err)
	}
	defer fsStateNotifier.Close()

	watchDirs := append([]string{cfg.SampleDir}, cfg.CheckpointDirs...)
	watchDirs = append(watchDirs, cfg.LoraDirs...)
	fsState.StartWatching(fsStateNotifier, watchDirs)
	// fsState.Stop() is called explicitly in performShutdown (before HTTP drain).

	// Create service implementations
	healthSvc := api.NewHealthService(cfg.MaxStudyItems, cfg.CheckpointDirs)
	docsSvc := api.NewDocsService(spec)
	validationSvc := service.NewValidationService(fs, cfg.SampleDir, logger)
	trainingRunsSvc := api.NewTrainingRunsService(viewerDiscovery, discovery, scanner, validationSvc, watcher, st)
	trainingRunsSvc.SetFSState(fsState)
	presetSvc := service.NewPresetService(st, logger)
	presetsSvc := api.NewPresetsService(presetSvc)
	studyAvailSvc := service.NewStudyAvailabilityService(fs, cfg.SampleDir, logger)
	studyDirRemover := store.NewStudyDirRemover(fs, cfg.SampleDir)
	studySvc := service.NewStudyService(st, studyAvailSvc, logger).WithSampleRemover(studyDirRemover).WithMaxStudyItems(cfg.MaxStudyItems)
	studiesSvc := api.NewStudiesService(studySvc, studyAvailSvc, discovery)
	studiesSvc.SetFSState(fsState)
	demoSvc := service.NewDemoService(fs, st, cfg.SampleDir, logger)
	demoAPISvc := api.NewDemoAPIService(demoSvc)
	demoAPISvc.SetFSState(fsState)

	// Auto-install demo dataset on first run if not already present
	if !demoSvc.Status().Installed {
		if err := demoSvc.Install(); err != nil {
			logger.WithError(err).Warn("failed to auto-install demo dataset on first run")
		} else {
			logger.Info("demo dataset auto-installed on first run")
		}
	}
	checkpointMetadataSvc := service.NewCheckpointMetadataService(fs, cfg.CheckpointDirs, cfg.LoraDirs, logger)
	checkpointsSvc := api.NewCheckpointsService(checkpointMetadataSvc)
	baseModelSvc := service.NewBaseModelService(fs, cfg.BaseModelDir, cfg.CheckpointDirs, logger)
	baseModelsSvc := api.NewBaseModelsService(baseModelSvc)
	imageMetadataSvc := service.NewImageMetadataService(fs, cfg.SampleDir, logger)
	imagesSvc := api.NewImagesService(cfg.SampleDir, fs, imageMetadataSvc, logger)
	wsPingInterval := time.Duration(cfg.WsPingInterval) * time.Second
	wsSvc := api.NewWSServiceWithPing(hub, wsPingInterval, logger)

	// Create sample job service (requires ComfyUI model discovery for path matching)
	var sampleJobsSvc *api.SampleJobsService
	if cfg.ComfyUI != nil {
		pathMatcher := service.NewCheckpointPathMatcher(modelDiscovery, logger)
		loraPathMatcher := service.NewLoraPathMatcher(modelDiscovery, logger)
		dirRemover := store.NewStudyOutputDirRemover(fs, cfg.SampleDir)
		sampleJobSvc := service.NewSampleJobService(st, pathMatcher, dirRemover, cfg.SampleDir, logger)
		sampleJobSvc.SetMaxStudyItems(cfg.MaxStudyItems)
		sampleJobSvc.SetLoraPathMatcher(loraPathMatcher)
		sampleJobSvc.SetFileChecker(&service.RealOutputFileChecker{})
		sampleJobSvc.SetJobDataRemover(store.NewJobSampleDirRemover(fs, cfg.SampleDir))
		sampleJobSvc.SetWorkflowRoleChecker(workflowLoader)

		// Wire the executor and service together (avoiding circular dependency)
		sampleJobSvc.SetExecutor(jobExecutor)
		jobExecutor.SetDirRemover(dirRemover)
		// B-143: resolve curated base_model_dir paths to ComfyUI unet_name at submission.
		jobExecutor.SetBaseModelMatcher(modelDiscovery)
		// S-161: resolve checkpoint/LoRA model paths lazily at execution time so jobs
		// can be queued while ComfyUI is offline.
		jobExecutor.SetPathMatchers(pathMatcher, loraPathMatcher)

		// Start the job executor (non-fatal if ComfyUI is unreachable)
		if err := jobExecutor.Start(); err != nil {
			logger.WithError(err).Warn("job executor failed to start, sample jobs may not work until ComfyUI is available")
			// Continue - the executor will retry connection in the background
		}
		// jobExecutor.Stop() is called explicitly in performShutdown (before HTTP drain).

		sampleJobsSvc = api.NewSampleJobsService(sampleJobSvc, discovery)
		sampleJobsSvc.SetFSState(fsState)
	} else {
		// Create a disabled service when ComfyUI is not configured
		// dirRemover is nil since there are no jobs to clear
		sampleJobsSvc = api.NewSampleJobsService(nil, discovery)
		sampleJobsSvc.SetFSState(fsState)
	}

	// Create Goa endpoints
	healthEndpoints := genhealth.NewEndpoints(healthSvc)
	docsEndpoints := gendocs.NewEndpoints(docsSvc)
	trainingRunsEndpoints := gentrainingruns.NewEndpoints(trainingRunsSvc)
	presetsEndpoints := genpresets.NewEndpoints(presetsSvc)
	studiesEndpoints := genstudies.NewEndpoints(studiesSvc)
	sampleJobsEndpoints := gensamplejobs.NewEndpoints(sampleJobsSvc)
	checkpointsEndpoints := gencheckpoints.NewEndpoints(checkpointsSvc)
	baseModelsEndpoints := genbasemodels.NewEndpoints(baseModelsSvc)
	comfyuiEndpoints := gencomfyui.NewEndpoints(comfyuiSvc)
	demoEndpoints := gendemo.NewEndpoints(demoAPISvc)
	workflowsEndpoints := genworkflows.NewEndpoints(workflowsSvc)
	imagesEndpoints := genimages.NewEndpoints(imagesSvc)
	wsEndpoints := genws.NewEndpoints(wsSvc)

	// Create sample directory cleaner and fixture seeder for test reset endpoint
	sampleDirCleaner := store.NewSampleDirCleaner(fs, cfg.SampleDir)
	fixtureSeeder := store.NewFixtureSeeder(st, cfg.SampleDir, logger)

	// Create partial sample seeder for the test-only seed-partial-samples endpoint
	partialSampleSeeder := api.NewFilesystemPartialSampleSeeder(cfg.SampleDir, logger)

	// Build the HTTP handler with all transport setup
	// st satisfies the JobSeeder interface via its SeedSampleJobs method.
	handler := api.NewHTTPHandler(api.HTTPHandlerConfig{
		HealthEndpoints:      healthEndpoints,
		DocsEndpoints:        docsEndpoints,
		TrainingRunEndpoints: trainingRunsEndpoints,
		PresetsEndpoints:     presetsEndpoints,
		StudiesEndpoints:     studiesEndpoints,
		SampleJobsEndpoints:  sampleJobsEndpoints,
		BaseModelsEndpoints:  baseModelsEndpoints,
		CheckpointsEndpoints: checkpointsEndpoints,
		ComfyUIEndpoints:     comfyuiEndpoints,
		WorkflowsEndpoints:   workflowsEndpoints,
		ImagesEndpoints:      imagesEndpoints,
		WSEndpoints:          wsEndpoints,
		DemoEndpoints:        demoEndpoints,
		SwaggerUIDir:         http.Dir(swaggerUIDir()),
		Logger:               logger,
		Debug:                true,
		WsPingInterval:       wsPingInterval,
		DBResetter:           st,
		BackgroundPauser:     bgPauser,
		SampleDirCleaner:     sampleDirCleaner,
		FixtureSeeder:        fixtureSeeder,
		JobSeeder:            st,
		PartialSampleSeeder:  partialSampleSeeder,
		MaxRequestSizeMB:     cfg.MaxRequestSizeMB,
		AllowedOrigins:       cfg.AllowedOrigins,
	})

	// Create HTTP server
	addr := net.JoinHostPort(cfg.IPAddress, fmt.Sprintf("%d", cfg.Port))
	srv := &http.Server{
		Addr:           addr,
		Handler:        handler,
		ReadTimeout:    30 * time.Second,
		WriteTimeout:   30 * time.Second,
		IdleTimeout:    120 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MB
	}

	// Graceful shutdown: collect the background workers that must stop before
	// the HTTP server drains and before the DB/notifiers close.
	// Order matters: workers → HTTP drain → deferred DB/notifier closes.
	// jobExecutor is a typed nil (*service.JobExecutor) when ComfyUI is not
	// configured; a typed nil wrapped in an interface is non-nil, so we only
	// append it when the pointer is actually non-nil.
	workers := []Stoppable{watcher, fsState}
	if jobExecutor != nil {
		workers = append([]Stoppable{jobExecutor}, workers...)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// shutdownDone is closed once performShutdown returns so that run() does not
	// return (and fire its deferred DB/notifier closes) until shutdown is complete.
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		performShutdown(ctx, srv, workers, 10*time.Second, logger)
	}()

	logger.WithField("address", addr).Info("starting server")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server error: %w", err)
	}

	// Block until shutdown goroutine has finished draining HTTP and stopping
	// background workers.  The deferred st.Close / notifier.Close calls below
	// only run after this, guaranteeing the DB is not closed while requests or
	// workers are still active.
	<-shutdownDone

	return nil
}

// openAPISpecPath returns the path to the generated OpenAPI 3.0 spec.
// In production (Dockerfile), it's at backend/gen/http/openapi3.json.
// In development, it's at backend/internal/api/gen/http/openapi3.json.
// Both are relative to CWD /app.
func openAPISpecPath() string {
	// Check production path first
	if _, err := os.Stat("backend/gen/http/openapi3.json"); err == nil {
		return "backend/gen/http/openapi3.json"
	}
	return "backend/internal/api/gen/http/openapi3.json"
}

// swaggerUIDir returns the base directory for static file serving.
// In production (Dockerfile), swagger-ui is at backend/public/swagger-ui/.
// In development, it's at backend/internal/api/design/public/swagger-ui/.
// Both are relative to CWD /app.
func swaggerUIDir() string {
	// Check production path first
	if _, err := os.Stat("backend/public/swagger-ui"); err == nil {
		return "backend"
	}
	return "backend/internal/api/design"
}
