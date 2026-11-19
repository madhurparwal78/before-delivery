import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  publicDir: 'public-src',
  build: {
    outDir: 'dist/public',
    emptyOutDir: true,
    target: 'es2022'
  }
});
