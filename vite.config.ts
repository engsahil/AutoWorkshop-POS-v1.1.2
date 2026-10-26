import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vitest runs with mode === 'test'; Vite builds and the dev server do not.
export default defineConfig(({ mode }) => ({
  mode,
  plugins: [
    react(),
    // The PWA plugin generates a manifest and service worker; skip it under
    // Vitest so unit tests stay fast and side-effect free.
    mode !== 'test' && VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'img/*.jpg', 'audio/*.wav', 'icons/*.png'],
      manifest: {
        name: 'Servixa — Auto Workshop Management POS',
        short_name: 'Servixa',
        description: 'Offline-capable auto workshop management, POS billing, job cards and inventory.',
        theme_color: '#38271D',
        background_color: '#F6F1E9',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,woff2,wav,webmanifest}'],
        // The PDF engine (~1.6 MB) is only fetched when someone imports a PDF.
        // It is cached on first use instead of being pre-downloaded for every
        // user on first visit.
        globIgnores: ['**/pdf-engine-*.js', '**/pdf.worker.min-*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/pdf-engine-.*\.js$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pdf-engine', expiration: { maxEntries: 4 } }
          },
          {
            urlPattern: /\/assets\/pdf\.worker\.min-.*\.(mjs|js)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pdf-worker', expiration: { maxEntries: 4 } }
          },
          {
            urlPattern: /\/api\//,
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ].filter(Boolean),
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          icons: ['lucide-react'],
          // Kept in its own lazily-loaded chunk so the PDF engine never blocks
          // the first paint and stays out of the service-worker precache.
          'pdf-engine': ['pdfjs-dist/legacy/build/pdf.mjs']
        }
      }
    }
  }
}));
