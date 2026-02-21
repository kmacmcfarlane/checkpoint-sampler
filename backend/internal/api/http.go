package api

import (
	"context"
	"log"
	"net/http"

	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/health"
	gendocssvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/docs/server"
	genhealthsvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/health/server"
	genpresetssvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/presets/server"
	gentrainingrunssvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/training_runs/server"
	genpresets "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/presets"
	gentrainingruns "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/training_runs"
	goahttp "goa.design/goa/v3/http"
	goahttpmiddleware "goa.design/goa/v3/http/middleware"
	goamiddleware "goa.design/goa/v3/middleware"
)

// HTTPHandlerConfig holds the dependencies needed by NewHTTPHandler.
type HTTPHandlerConfig struct {
	HealthEndpoints      *genhealth.Endpoints
	DocsEndpoints        *gendocs.Endpoints
	TrainingRunEndpoints *gentrainingruns.Endpoints
	PresetsEndpoints     *genpresets.Endpoints
	ImageHandler         *ImageHandler
	SwaggerUIDir         http.FileSystem
	Logger               *log.Logger
	Debug                bool
}

// NewHTTPHandler creates a fully wired http.Handler with all Goa services,
// custom handlers, and middleware. The caller is responsible for dependency
// injection (creating services and endpoints); this function owns the HTTP
// transport layer.
func NewHTTPHandler(cfg HTTPHandlerConfig) http.Handler {
	mux := goahttp.NewMuxer()

	dec := goahttp.RequestDecoder
	enc := goahttp.ResponseEncoder

	var eh func(context.Context, http.ResponseWriter, error)
	if cfg.Debug {
		eh = errorHandler(cfg.Logger)
	}

	healthServer := genhealthsvr.New(cfg.HealthEndpoints, mux, dec, enc, eh, nil)
	docsServer := gendocssvr.New(cfg.DocsEndpoints, mux, dec, enc, eh, nil, cfg.SwaggerUIDir)
	trainingRunsServer := gentrainingrunssvr.New(cfg.TrainingRunEndpoints, mux, dec, enc, eh, nil)
	presetsServer := genpresetssvr.New(cfg.PresetsEndpoints, mux, dec, enc, eh, nil)

	healthServer.Mount(mux)
	docsServer.Mount(mux)
	trainingRunsServer.Mount(mux)
	presetsServer.Mount(mux)

	// Mount custom image serving handler
	mux.Handle("GET", "/api/images/{*filepath}", cfg.ImageHandler.ServeHTTP)

	// Redirect /docs to /docs/ for the Swagger UI
	mux.Handle("GET", "/docs", http.RedirectHandler("/docs/", http.StatusMovedPermanently).ServeHTTP)

	// Log mounts when debug is enabled
	if cfg.Debug && cfg.Logger != nil {
		for _, m := range healthServer.Mounts {
			cfg.Logger.Printf("HTTP %q mounted on %s %s", m.Method, m.Verb, m.Pattern)
		}
		for _, m := range docsServer.Mounts {
			cfg.Logger.Printf("HTTP %q mounted on %s %s", m.Method, m.Verb, m.Pattern)
		}
		for _, m := range trainingRunsServer.Mounts {
			cfg.Logger.Printf("HTTP %q mounted on %s %s", m.Method, m.Verb, m.Pattern)
		}
		for _, m := range presetsServer.Mounts {
			cfg.Logger.Printf("HTTP %q mounted on %s %s", m.Method, m.Verb, m.Pattern)
		}
		cfg.Logger.Printf("HTTP image handler mounted on GET /api/images/{*filepath}")
		cfg.Logger.Printf("HTTP redirect /docs -> /docs/")
	}

	// Apply HTTP-level middleware
	var handler http.Handler = mux
	handler = goahttpmiddleware.RequestID()(handler)
	handler = CORSMiddleware("*")(handler)

	return handler
}

// errorHandler returns a function that logs HTTP encoding errors with the
// request ID for correlation.
func errorHandler(logger *log.Logger) func(context.Context, http.ResponseWriter, error) {
	return func(ctx context.Context, w http.ResponseWriter, err error) {
		id, _ := ctx.Value(goamiddleware.RequestIDKey).(string)
		if logger != nil {
			logger.Printf("[%s] encoding error: %v", id, err)
		}
	}
}
