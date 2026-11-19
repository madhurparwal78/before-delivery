import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sampleGlb, sampleNames } from './samples';

const out = process.argv[2];
if (!out) throw new Error('usage: samples-cli <output directory>');
mkdirSync(out, { recursive: true });
for (const name of sampleNames) writeFileSync(join(out, `${name}.glb`), sampleGlb(name));
