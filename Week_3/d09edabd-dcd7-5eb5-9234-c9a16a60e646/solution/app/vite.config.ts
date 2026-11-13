import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  publicDir: '../../public',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '../../dist/public',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
