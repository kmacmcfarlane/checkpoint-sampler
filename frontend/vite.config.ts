import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://backend:8080',
        // Do NOT set changeOrigin: it rewrites the forwarded Host header to
        // "backend:8080", which breaks the backend same-host WebSocket origin
        // check (S-151): the browser's Origin hostname would never match the
        // rewritten Host, so the /api/ws upgrade is rejected. Preserving the
        // original Host keeps Origin==Host and lets the upgrade through.
        ws: true,
      },
      '/health': {
        target: 'http://backend:8080',
        changeOrigin: true,
      },
      '/docs': {
        target: 'http://backend:8080',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    exclude: [...configDefaults.exclude, '**/e2e/**'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 2,
      },
    },
  },
})
