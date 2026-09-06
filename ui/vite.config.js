import { defineConfig } from 'vite'

// base './' so the built bundle opens from the file system as well as from a
// web server. The demo has to survive a laptop with no network (ADR-0012 DIL,
// ADR-0018).
export default defineConfig({
  base: './',
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
