// Builds the UI bundle and static assets into build/public.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build/builder/main.js';

const uiDir = fileURLToPath(new URL('./ui', import.meta.url));
const distDir = fileURLToPath(new URL('./build/public', import.meta.url));
mkdirSync(distDir, { recursive: true });

for (const file of await build({ rootDir: uiDir, outDir: distDir })) {
  const bytes = await file.read();
  const target = fileURLToPath(new URL('./build/public/' + file.out, import.meta.url));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  console.log('built ' + file.out + ' (' + bytes.byteLength + ' bytes)');
}
