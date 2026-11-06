#!/usr/bin/env node
// Build step for the browser bundle using the esbuild JS API.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const result = await esbuild.build({
  entryPoints: ['client/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2022', 'safari16'],
  legalComments: 'none',
  sourcemap: false,
  metafile: false,
  outfile: 'public/assets/app.js',
  logLevel: 'info'
});
if (result.errors.length) process.exit(1);
