import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  root: here('./src/client'),
  publicDir: here('./public'),
  plugins: [react()],
  build: {
    outDir: here('./dist/client'),
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: 'assets',
  },
});
