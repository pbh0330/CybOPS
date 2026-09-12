import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built bundle opens from the file system as well as from a
// web server. The demo has to survive a laptop with no network (ADR-0012 DIL,
// ADR-0018). React is a rendering change only - the bundle stays static and
// self-contained, with no CDN (ADR-0024).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5180,
    open: true,
  },
})
