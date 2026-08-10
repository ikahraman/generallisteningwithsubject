import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    // Client code calls relative /api and /synthesize paths (same pattern
    // nginx uses in production to reverse-proxy them to the companion
    // server) — this makes that work against `npm run dev` too.
    proxy: {
      '/api': 'http://localhost:5175',
      '/synthesize': 'http://localhost:5175',
    },
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false, // we ship our own public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json}'],
      },
      includeAssets: ['favicon.svg', 'icons/*.png'],
    }),
  ],
})
