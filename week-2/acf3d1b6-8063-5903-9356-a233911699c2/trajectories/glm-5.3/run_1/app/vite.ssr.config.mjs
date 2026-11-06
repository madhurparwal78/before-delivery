import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The server-side bundle of the app, used by the page renderer.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: 'dist/ssr',
    emptyOutDir: true,
    lib: {
      entry: 'src/browser/app.jsx',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['preact', 'preact/hooks', 'preact-iso', 'preact-render-to-string'],
      output: {
        entryFileNames: 'app.mjs',
        chunkFileNames: 'chunk-[hash].mjs',
      },
    },
  },
});
