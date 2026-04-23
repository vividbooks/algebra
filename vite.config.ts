import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Custom domain (e.g. algebra.vividbooks.com via GitHub Pages): assets must use base `/`.
// Optional: `GITHUB_PAGES=true npm run build` for the legacy project URL https://vividbooks.github.io/algebra/
const base = process.env.GITHUB_PAGES === 'true' ? '/algebra/' : '/'

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 3001,
    host: '127.0.0.1',
  },
  preview: {
    port: 3001,
    host: '127.0.0.1',
  },
})
