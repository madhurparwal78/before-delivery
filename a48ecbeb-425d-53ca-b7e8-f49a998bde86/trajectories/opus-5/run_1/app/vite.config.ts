import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  publicDir: '../public',
  plugins: [react()],
  build: { outDir: '../dist/client', emptyOutDir: true, assetsDir: 'assets', sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:4173' } },
});
