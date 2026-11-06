import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
});
