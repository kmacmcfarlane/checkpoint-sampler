package api

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/gorilla/websocket"
	gencheckpoints "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/checkpoints"
	gencomfyui "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/comfyui"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/health"
	gencheckpointssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/checkpoints/server"
	gencomfyuisvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/comfyui/server"
	gendocssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/docs/server"
	genhealthsvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/health/server"
	genimagessvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/images/server"
	genpresetssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/presets/server"
	gensamplejobssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/sample_jobs/server"
	gensamplepresetssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/sample_presets/server"
	gentrainingrunssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/training_runs/server"
	genworkflowssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/workflows/server"
	genwssvr "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/http/ws/server"
	genimages "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/images"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/presets"
	gensamplejobs "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_jobs"
	gensamplepresets "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/sample_presets"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/training_runs"
	genworkflows "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/workflows"
	genws "github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/api/gen/ws"
	"github.com/sirupsen/logrus"
	goahttp "goa.design/goa/v3/http"
	goahttpmiddleware "goa.design/goa/v3/http/middleware"
	goamiddleware "goa.design/goa/v3/middleware"
)

// HTTPHandlerConfig holds the dependencies needed by NewHTTPHandler.
type HTTPHandlerConfig struct {
	HealthEndpoints        *genhealth.Endpoints
	DocsEndpoints          *gendocs.Endpoints
	TrainingRunEndpoints   *gentrainingruns.Endpoints
	PresetsEndpoints       *genpresets.Endpoints
	SamplePresetsEndpoints *gensamplepresets.Endpoints
	SampleJobsEndpoints    *gensamplejobs.Endpoints
	CheckpointsEndpoints   *gencheckpoints.Endpoints
	ComfyUIEndpoints       *gencomfyui.Endpoints
	WorkflowsEndpoints     *genworkflows.Endpoints
	ImagesEndpoints        *genimages.Endpoints
	WSEndpoints            *genws.Endpoints
	SwaggerUIDir           http.FileSystem
	Logger                 *logrus.Logger
	Debug                  bool
}

// NewHTTPHandler creates a fully wired http.Handler with all Goa services,
// custom handlers, and middleware. The caller is responsible for dependency
// injection (creating services and endpoints); this function owns the HTTP
// transport layer.
func NewHTTPHandler(cfg HTTPHandlerConfig) http.Handler {
	mux := goahttp.NewMuxer()

	dec := goahttp.RequestDecoder
	enc := goahttp.ResponseEncoder

	var eh = errorHandler(cfg.Logger)

	healthServer := genhealthsvr.New(cfg.HealthEndpoints, mux, dec, enc, eh, nil)
	docsServer := gendocssvr.New(cfg.DocsEndpoints, mux, dec, enc, eh, nil, cfg.SwaggerUIDir)
	trainingRunsServer := gentrainingrunssvr.New(cfg.TrainingRunEndpoints, mux, dec, enc, eh, nil)
	presetsServer := genpresetssvr.New(cfg.PresetsEndpoints, mux, dec, enc, eh, nil)
	samplePresetsServer := gensamplepresetssvr.New(cfg.SamplePresetsEndpoints, mux, dec, enc, eh, nil)
	sampleJobsServer := gensamplejobssvr.New(cfg.SampleJobsEndpoints, mux, dec, enc, eh, nil)
	checkpointsServer := gencheckpointssvr.New(cfg.CheckpointsEndpoints, mux, dec, enc, eh, nil)
	comfyuiServer := gencomfyuisvr.New(cfg.ComfyUIEndpoints, mux, dec, enc, eh, nil)
	workflowsServer := genworkflowssvr.New(cfg.WorkflowsEndpoints, mux, dec, enc, eh, nil)
	imagesServer := genimagessvr.New(cfg.ImagesEndpoints, mux, dec, enc, eh, nil)

	// WebSocket upgrader with permissive origin check for local/LAN use
	upgrader := &websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	wsServer := genwssvr.New(cfg.WSEndpoints, mux, dec, enc, eh, nil, upgrader, nil)

	// Apply Debug middleware when debug mode is enabled (logs full request/response)
	if cfg.Debug {
		healthServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		docsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		trainingRunsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		presetsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		samplePresetsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		sampleJobsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		checkpointsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		comfyuiServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		workflowsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		// DO NOT LOG BINARY IMAGE DATA, IT'S ANNOYING imagesServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
		wsServer.Use(goahttpmiddleware.Debug(mux, os.Stdout))
	}

	healthServer.Mount(mux)
	docsServer.Mount(mux)
	trainingRunsServer.Mount(mux)
	presetsServer.Mount(mux)
	samplePresetsServer.Mount(mux)
	sampleJobsServer.Mount(mux)
	checkpointsServer.Mount(mux)
	comfyuiServer.Mount(mux)
	workflowsServer.Mount(mux)
	imagesServer.Mount(mux)
	wsServer.Mount(mux)

	// Redirect /docs to /docs/ for the Swagger UI
	mux.Handle("GET", "/docs", http.RedirectHandler("/docs/", http.StatusMovedPermanently).ServeHTTP)

	// Log mounts when debug is enabled
	if cfg.Debug {
		for _, m := range healthServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range docsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range trainingRunsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range presetsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range samplePresetsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range sampleJobsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range checkpointsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range comfyuiServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range workflowsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range imagesServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		for _, m := range wsServer.Mounts {
			cfg.Logger.WithFields(logrus.Fields{
				"method":  m.Method,
				"verb":    m.Verb,
				"pattern": m.Pattern,
			}).Debug("HTTP endpoint mounted")
		}
		cfg.Logger.Debug("HTTP redirect /docs -> /docs/ mounted")
	}

	// Apply HTTP-level middleware
	var handler http.Handler = mux
	// Apply URL rewrite middleware first (innermost, closest to the mux)
	handler = imageMetadataRewriteMiddleware(handler)
	// Create a logrus adapter for Goa middleware
	adapter := &logrusAdapter{logger: cfg.Logger.WithField("component", "http")}
	handler = goahttpmiddleware.Log(adapter)(handler)
	handler = ErrorLoggingMiddleware(cfg.Logger)(handler)
	handler = goahttpmiddleware.RequestID()(handler)
	handler = CORSMiddleware("*")(handler)

	return handler
}

// imageMetadataRewriteMiddleware rewrites /api/images/{path}/metadata requests
// to /api/_images_metadata/{path} to work around chi router's wildcard limitation.
// This allows the frontend to use the natural URL pattern while routing to the
// Goa-generated handler which uses an internal path structure.
func imageMetadataRewriteMiddleware(next http.Handler) http.Handler {
	const metadataSuffix = "/metadata"
	const imagePrefix = "/api/images/"
	const rewritePrefix = "/api/_images_metadata/"

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, imagePrefix) && strings.HasSuffix(r.URL.Path, metadataSuffix) {
			// Extract the filepath between /api/images/ and /metadata
			filepath := r.URL.Path[len(imagePrefix) : len(r.URL.Path)-len(metadataSuffix)]
			if filepath != "" {
				// Clone the request and rewrite the path
				r2 := r.Clone(r.Context())
				r2.URL.Path = rewritePrefix + filepath
				r2.RequestURI = r2.URL.RequestURI()
				next.ServeHTTP(w, r2)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// logrusAdapter adapts a logrus.Logger to the goamiddleware.Logger interface.
type logrusAdapter struct {
	logger *logrus.Entry
}

func (a *logrusAdapter) Log(keyvals ...interface{}) error {
	fields := logrus.Fields{}
	for i := 0; i < len(keyvals); i += 2 {
		if i+1 < len(keyvals) {
			key, ok := keyvals[i].(string)
			if ok {
				fields[key] = keyvals[i+1]
			}
		}
	}
	a.logger.WithFields(fields).Info("HTTP request")
	return nil
}

// errorHandler returns a function that logs HTTP encoding errors with the
// request ID for correlation.
func errorHandler(logger *logrus.Logger) func(context.Context, http.ResponseWriter, error) {
	return func(ctx context.Context, w http.ResponseWriter, err error) {
		id, _ := ctx.Value(goamiddleware.RequestIDKey).(string)
		logger.WithFields(logrus.Fields{
			"request_id": id,
			"error":      err.Error(),
		}).Error("HTTP encoding error")
	}
}
