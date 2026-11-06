import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'dist/public/js';

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(full);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = await readFile(full, 'utf8');
    const fixed = source.replace(
      /(\bfrom\s+|\bimport\s+)(['"])(\.[^'"]*)(['"])/g,
      (whole, lead, open, specifier, close) =>
        specifier.endsWith('.js') ? whole : `${lead}${open}${specifier}.js${close}`,
    );
    if (fixed !== source) await writeFile(full, fixed);
  }
}

await walk(root);
