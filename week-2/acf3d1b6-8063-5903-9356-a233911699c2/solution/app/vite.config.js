import { defineConfig } from 'vite';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  build: { outDir: 'dist/client', assetsInlineLimit: 0, sourcemap: false },
  ssr: { noExternal: [] },
});
