FROM golang:1.25-alpine AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# goa CLI version is pinned in internal/api/generate.go's go:generate
# directive (must match goa.design/goa/v3 in go.mod). `go generate` invokes
# it via `go run`, so no goa binary needs to be pre-installed.
RUN go generate ./internal/api/...
ARG COMMIT_SHA=unknown
RUN go build -ldflags "-X github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/buildinfo.CommitSHA=${COMMIT_SHA}" -o server ./cmd/server

FROM alpine:3.21
# alpine's busybox already provides wget (used by the container healthcheck
# in docker-compose.yml) — no extra package needed.
WORKDIR /app
COPY --from=builder /build/server ./backend/bin/server
COPY --from=builder /build/internal/api/design/public ./backend/public
COPY --from=builder /build/internal/api/gen/http/openapi3.json ./backend/gen/http/openapi3.json

# Non-root by default (S-176). UID/GID 1000 matches the common first-user
# UID on single-user Linux hosts and the default used by docker-compose.yml's
# PUID/PGID overrides. Override PUID/PGID in .env to match your host user if
# SAMPLE_DIR or the db volume are owned by a different UID/GID.
RUN addgroup -g 1000 appuser && adduser -D -u 1000 -G appuser appuser
RUN mkdir -p /app/data && chown -R appuser:appuser /app
USER appuser
EXPOSE 8080
CMD ["./backend/bin/server"]
