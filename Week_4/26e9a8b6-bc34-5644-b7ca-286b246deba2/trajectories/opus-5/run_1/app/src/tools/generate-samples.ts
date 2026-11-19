import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLE_SOLIDS, buildSampleGlb } from './sample-models.js';

const outputDir = process.argv[2];
if (outputDir === undefined) throw new Error('usage: generate-samples <output directory>');

mkdirSync(outputDir, { recursive: true });
for (const [name, roots] of Object.entries(SAMPLE_SOLIDS)) {
  const bytes = buildSampleGlb(roots, 'Pennywasher build');
  writeFileSync(join(outputDir, `${name}.glb`), bytes);
  process.stdout.write(`${name}.glb ${bytes.byteLength} bytes\n`);
}
