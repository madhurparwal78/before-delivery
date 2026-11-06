import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist/browser',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/entry.mjs',
      output: {
        entryFileNames: 'assets/entry.mjs',
        chunkFileNames: 'assets/chunk-[hash].mjs',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
