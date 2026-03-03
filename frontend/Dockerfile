FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
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
