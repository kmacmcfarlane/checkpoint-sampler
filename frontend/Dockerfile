FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Unprivileged nginx image (S-176): pre-configured so the master process
# itself (not just workers) can run as a non-root UID — regular nginx:alpine
# runs its master process as root to bind privileged ports and write
# root-owned pid/cache paths. This variant relocates those paths so an
# arbitrary non-root UID (set via docker-compose.yml's default USER below)
# can run the whole process tree. We only ever bind port 3000 (unprivileged),
# so this is a drop-in swap with no config changes required.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Validate nginx config syntax and required WebSocket headers
RUN nginx -t && \
    grep -q 'proxy_http_version 1\.1' /etc/nginx/conf.d/default.conf && \
    grep -q 'proxy_set_header Upgrade' /etc/nginx/conf.d/default.conf && \
    grep -qE 'proxy_set_header Connection "upgrade"' /etc/nginx/conf.d/default.conf && \
    echo "nginx config validation passed"
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
