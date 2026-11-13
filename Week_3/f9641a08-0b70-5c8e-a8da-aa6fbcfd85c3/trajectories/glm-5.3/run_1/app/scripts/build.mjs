import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public', { recursive: true });
mkdirSync('dist', { recursive: true });

// 1. Compile the server with tsc (via esbuild for speed, then tsc for types).
const server = await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist/server.js',
  external: ['pg', 'pg-native', 'express', 'nodemailer', 'multer', 'cookie-parser'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
  logLevel: 'silent',
});
console.log('server built');

// 2. Copy the schema next to the build output so it ships.
writeFileSync('dist/schema.sql', readFileSync('src/db/schema.sql', 'utf8'));

// 3. Build the client bundle.
await build({
  entryPoints: ['client/main.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'public/app.js',
  minify: true,
  sourcemap: false,
  logLevel: 'silent',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { 'process.env.NODE_ENV': '"production"' },
});
console.log('client built');
