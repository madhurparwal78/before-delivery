// Copies the public web app into dist/server/public, ready to serve.

import { cp, mkdir, readdir, access, copyFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const target = join(projectRoot, 'dist', 'server', 'public');

// Server resources read at runtime: the schema and the seed data.
for (const resource of ['schema.sql', 'seed.json']) {
  await copyFile(join(projectRoot, 'src', 'server', resource), join(projectRoot, 'dist', 'server', resource));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

await mkdir(target, { recursive: true });
const web = join(projectRoot, 'web');
if (await exists(web)) {
  for (const entry of await readdir(web)) {
    await cp(join(web, entry), join(target, entry), { recursive: true });
  }
  console.log('static web app copied to dist/server/public');
} else {
  console.log('no web directory; dist/server/public left empty');
}
