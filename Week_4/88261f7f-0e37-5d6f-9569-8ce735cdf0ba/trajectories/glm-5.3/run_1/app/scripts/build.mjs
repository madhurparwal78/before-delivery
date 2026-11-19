import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src', 'public');
const dest = join(root, 'dist', 'public');

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await copyDir(join(from, entry.name), join(to, entry.name));
    else await copyFile(join(from, entry.name), join(to, entry.name));
  }
}

await copyDir(src, dest);
