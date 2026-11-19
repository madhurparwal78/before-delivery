import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    target: 'es2022',
    assetsInlineLimit: 0,
    // three.js is the one large dependency; it ships as its own cacheable chunk, and 3D is the product, so its size is expected.
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: id => (id.includes('node_modules/three/') ? 'three' : undefined) } },
  },
  publicDir: 'public',
})
