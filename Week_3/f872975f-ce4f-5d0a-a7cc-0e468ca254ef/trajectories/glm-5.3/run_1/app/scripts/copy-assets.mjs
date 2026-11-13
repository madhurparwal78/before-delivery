import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const assets = join(process.cwd(), 'src', 'client', 'assets');
const dest = join(process.cwd(), 'dist', 'client');
await rm(join(dest, 'fonts'), { recursive: true, force: true });
await mkdir(join(dest, 'fonts'), { recursive: true });
await mkdir(join(dest, 'pages'), { recursive: true });

// static assets: index.html, styles.css, fonts
for (const entry of await readdir(assets, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    await cp(join(assets, entry.name), join(dest, entry.name), { recursive: true });
  } else {
    await cp(join(assets, entry.name), join(dest, entry.name));
  }
}
console.log('client assets copied');

