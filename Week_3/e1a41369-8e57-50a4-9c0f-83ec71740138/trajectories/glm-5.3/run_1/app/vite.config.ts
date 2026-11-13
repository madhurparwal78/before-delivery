import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  root: 'src/client',
  publicDir: 'public',
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: '../../dist/public',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    cssCodeSplit: false,
    minify: false,
    jsx: 'automatic',
  },
});
