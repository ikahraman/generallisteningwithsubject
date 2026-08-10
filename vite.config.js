import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
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
