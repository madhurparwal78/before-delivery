// Builds the production bundle: esbuild the client, copy css and vendored media.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const PUBLIC = path.join(ROOT, 'public');

fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });

// 1. the client bundle
await esbuild.build({
  entryPoints: [path.join(PUBLIC, 'src', 'app.js')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(DIST, 'assets', 'app.js'),
  logLevel: 'info',
});

// 2. styles
fs.copyFileSync(path.join(PUBLIC, 'src', 'styles.css'), path.join(DIST, 'assets', 'styles.css'));

// 3. vendored media (avoids, sounds, manifest)
await import('./assets.mjs');

// 4. a static copy of the CSS lives in public too for the source map of truth
console.log('build complete');
