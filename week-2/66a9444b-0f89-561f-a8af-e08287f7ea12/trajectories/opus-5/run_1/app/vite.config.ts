import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets',
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:4173' },
  },
});
