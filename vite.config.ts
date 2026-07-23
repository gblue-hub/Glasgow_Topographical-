/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { coordinateEditor } from './server/vite-coordinate-editor.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), coordinateEditor(import.meta.dirname)],
  server: {
    watch: {
      // Builders update these after an in-app coordinate save. The current UI
      // already has the saved coordinate, so reloading would only discard
      // navigation and session state. Direct canonical-source edits still
      // trigger the explicit full reload above.
      ignored: [
        '**/data/generated/**',
        '**/data/reports/**',
        '**/public/data/**',
      ],
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
  },
})
