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

	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api"
	gendocs "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/docs"
	genhealth "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/health"
	gendocssvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/docs/server"
	genhealthsvr "github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/api/gen/http/health/server"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/config"
	"github.com/kmacmcfarlane/checkpoint-sampler/local-web-app/backend/internal/store"
	goahttp "goa.design/goa/v3/http"
	goahttpmiddleware "goa.design/goa/v3/http/middleware"
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

	// Create service implementations
	healthSvc := api.NewHealthService()
	docsSvc := api.NewDocsService(spec)

	// Create Goa endpoints
	healthEndpoints := genhealth.NewEndpoints(healthSvc)
	docsEndpoints := gendocs.NewEndpoints(docsSvc)

	// Create Goa mux and mount handlers
	mux := goahttp.NewMuxer()

	dec := goahttp.RequestDecoder
	enc := goahttp.ResponseEncoder

	healthServer := genhealthsvr.New(healthEndpoints, mux, dec, enc, nil, nil)
	docsServer := gendocssvr.New(docsEndpoints, mux, dec, enc, nil, nil, http.Dir(swaggerUIDir()))

	healthServer.Mount(mux)
	docsServer.Mount(mux)

	// Redirect /docs to /docs/ for the Swagger UI
	mux.Handle("GET", "/docs", http.RedirectHandler("/docs/", http.StatusMovedPermanently).ServeHTTP)

	// Wrap with middleware
	var handler http.Handler = mux
	handler = goahttpmiddleware.RequestID()(handler)
	handler = api.CORSMiddleware("*")(handler)

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

