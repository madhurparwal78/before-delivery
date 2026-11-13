import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** TypeScript source is imported with `.js` specifiers, as Node's ESM resolution needs. */
function typescriptSourceSpecifiers(): Plugin {
  return {
    name: 'typescript-source-specifiers',
    enforce: 'pre',
    resolveId(source, importer) {
      if (importer === undefined || !source.startsWith('.') || !source.endsWith('.js')) return null;
      const base = resolve(dirname(importer), source.slice(0, -3));
      for (const candidate of [`${base}.ts`, `${base}.tsx`]) {
        if (existsSync(candidate)) return candidate;
      }
      return null;
    },
  };
}

export default defineConfig({
  root: 'client',
  plugins: [typescriptSourceSpecifiers(), react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 0,
  },
});
