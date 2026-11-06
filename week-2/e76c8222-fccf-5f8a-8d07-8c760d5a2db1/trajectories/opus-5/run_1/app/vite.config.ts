import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
  plugins: [react()],
});
