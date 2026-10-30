import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  base: '/',
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
});
