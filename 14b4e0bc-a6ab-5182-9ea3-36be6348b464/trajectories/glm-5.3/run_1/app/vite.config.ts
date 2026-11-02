import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  root: 'client',
  plugins: [react() as Plugin],
  build: {
    outDir: '../public',
    emptyOutDir: true,
    assetsDir: 'static',
    rollupOptions: {
      output: {
        assetFileNames: (info: { names: string[] }) => {
          const names = info.names ?? [];
          if (names.some((n) => n.endsWith('.woff2'))) return 'static/fonts/[name]-[hash][extname]';
          return 'static/[name]-[hash][extname]';
        },
        entryFileNames: 'static/[name]-[hash].js',
        chunkFileNames: 'static/[name]-[hash].js',
      },
    },
  },
});
