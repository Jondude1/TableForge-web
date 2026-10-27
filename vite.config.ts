import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Source lives in app/. The built site goes to dist/ and is published both to the
// gh-pages branch and to the root of main, so GitHub Pages works with either setting.
// Served from https://jondude1.github.io/TableForge-web/
export default defineConfig({
  root: 'app',
  base: '/TableForge-web/',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false, outDir: '../dist', emptyOutDir: true },
})
