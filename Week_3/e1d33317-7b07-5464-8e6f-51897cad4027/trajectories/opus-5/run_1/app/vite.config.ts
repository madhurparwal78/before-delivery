import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  base: '/',
  build: {
    outDir: '../../dist/client',
    emptyOutDir: false,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
  },
});
