import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Honor the PORT env var (used by the preview harness); fall back to Vite's default.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
    watch: {
      // The backend lives in server/ and writes runtime files (agent_workspace,
      // users.json) while the app is in use — without this ignore, those writes
      // trigger a full page reload that wipes the chat mid-conversation.
      ignored: ['**/server/**', '**/agent_workspace/**'],
    },
  },
})
