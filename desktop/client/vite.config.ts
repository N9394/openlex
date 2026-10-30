import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Content-Security-Policy of the built app (Electron loads it from file://;
// the web build is served same-origin). Nothing remote may load or be
// contacted from the page: an AI answer that smuggles an image or a request
// to another site (prompt injection) is blocked by the browser itself.
// connect-src: the page's own origin and the old local desktop server
// (OPENLEX_LEGACY_SERVER, 127.0.0.1:18000); the engine is reached over IPC.
// Only in the build: the dev server needs inline scripts for hot reload.
export const CSP = [
  "default-src 'self' file:",
  "script-src 'self' file:",
  "style-src 'self' file: 'unsafe-inline'",
  "img-src 'self' file: data: blob:",
  "font-src 'self' file: data:",
  "media-src 'self' file: data: blob:",
  "connect-src 'self' http://127.0.0.1:18000 http://localhost:18000",
  "frame-src 'self' blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'openlex-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }],
    },
  }
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // Relative asset paths so the bundled client works under file:// in
  // Electron. Without this, /assets/index-*.js resolves to drive root on
  // Windows and the page renders as a blank background.
  base: './',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
