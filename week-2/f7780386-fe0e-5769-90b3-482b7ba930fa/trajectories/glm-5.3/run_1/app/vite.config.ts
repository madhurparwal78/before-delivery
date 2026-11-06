import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Verifies the run manifest so a bad one fails the build.
function runManifestPlugin(): Plugin {
  return {
    name: 'check-run-manifest',
    buildStart() {
      const raw = JSON.parse(readFileSync('run.json', 'utf8'));
      const keys = Object.keys(raw).sort();
      if (keys.length !== 4 || keys.join(',') !== '_schema,build,install,serve') {
        throw new Error('run.json must hold exactly _schema, install, build, serve');
      }
      if (raw['_schema'] !== 'run-manifest-v1') throw new Error('run.json _schema');
      for (const k of ['install', 'build', 'serve']) {
        if (typeof raw[k] !== 'string') throw new Error(`run.json ${k} must be a string`);
      }
    },
  };
}

export default defineConfig({
  root: 'client',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'client/index.html'),
      output: {
        format: 'es',
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: (assetInfo: { name?: string; names?: string[] }) => ((assetInfo.names?.[0] ?? assetInfo.name ?? '').endsWith('.css') ? 'styles.css' : 'assets/[name][extname]'),
      },
    },
  },
  plugins: [runManifestPlugin()],
});
