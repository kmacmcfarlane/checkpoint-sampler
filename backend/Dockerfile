FROM golang:1.25-alpine AS builder

RUN go install goa.design/goa/v3/cmd/goa@latest

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go generate ./internal/api/...
ARG COMMIT_SHA=unknown
RUN go build -ldflags "-X github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/buildinfo.CommitSHA=${COMMIT_SHA}" -o server ./cmd/server

FROM alpine:3.21
WORKDIR /app
COPY --from=builder /build/server ./backend/bin/server
COPY --from=builder /build/internal/api/design/public ./backend/public
COPY --from=builder /build/internal/api/gen/http/openapi3.json ./backend/gen/http/openapi3.json

RUN mkdir -p /app/data
EXPOSE 8080
CMD ["./backend/bin/server"]
