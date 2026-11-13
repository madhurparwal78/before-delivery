// Build: compile the server modules to dist/ and bundle the frontend into
// public/. Fonts and styles are already in public/.

import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';

await fs.rm('dist', { recursive: true, force: true });

async function listServerModules() {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
  }
  await walk('src/server');
  return out;
}

const modules = await listServerModules();

await build({
  entryPoints: modules,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outdir: 'dist',
  outbase: 'src',
  sourcemap: false,
});

await build({
  entryPoints: ['src/frontend/app.ts'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'public/js/app.js',
  minify: true,
  sourcemap: false,
});

console.log('built');
