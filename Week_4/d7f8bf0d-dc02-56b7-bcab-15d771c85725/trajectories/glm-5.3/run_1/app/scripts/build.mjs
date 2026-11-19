import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'web'), { recursive: true });

// Inline the SQL schema into the seed module before the server bundle is built.
const schemaSql = fs.readFileSync(path.join(root, 'src/server/schema.sql'), 'utf8');
const seedPath = path.join(root, 'src/server/seed.ts');
const originalSeed = fs.readFileSync(seedPath, 'utf8');
const patchedSeed = originalSeed.replace('SCHEMA_PLACEHOLDER', () => schemaSql.replace(/`/g, '\\`').replace(/\$\{/g, '\\${'));
fs.writeFileSync(seedPath, patchedSeed, 'utf8');

try {
  await build({
    entryPoints: [path.join(root, 'src/server/main.ts')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: path.join(out, 'server/main.js'),
    sourcemap: false,
    external: ['pg', 'redis'],
    logLevel: 'info',
  });
} finally {
  fs.writeFileSync(seedPath, originalSeed, 'utf8');
}

await viteBuild({
  configFile: false,
  root: path.join(root, 'src/web'),
  plugins: [react()],
  base: '/',
  build: {
    outDir: path.join(out, 'web'),
    emptyOutDir: false,
    target: 'es2022',
  },
});

fs.writeFileSync(path.join(out, 'web/version.txt'), String(Date.now()));
console.log('build complete');
