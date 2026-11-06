import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    sourcemap: false,
  },
});
