import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { buildAssets } from '../src/web/assets.js';

const target = new URL('../dist/assets/', import.meta.url);
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
mkdirSync(target, { recursive: true });

for (const [name, body] of buildAssets()) {
  writeFileSync(new URL(name, target), body);
  process.stdout.write(`built assets/${name}\n`);
}
