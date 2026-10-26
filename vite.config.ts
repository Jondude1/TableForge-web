import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://jondude1.github.io/TableForge-web/
export default defineConfig({
  base: '/TableForge-web/',
  plugins: [react()],
  build: { target: 'es2020', sourcemap: false },
})
