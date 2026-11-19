/** Copies the static assets into the client dist directory (build step). */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const dist = join(root, 'src/client/dist');
const assets = join(dist, 'assets');
mkdirSync(assets, { recursive: true });
copyFileSync(join(root, 'src/client/index.html'), join(dist, 'index.html'));
copyFileSync(join(root, 'src/client/styles.css'), join(dist, 'styles.css'));
for (const name of readdirSync(join(root, 'src/fonts'))) {
  if (name.endsWith('.woff2')) copyFileSync(join(root, 'src/fonts', name), join(assets, name));
}
// the PDF fonts land beside the compiled server (dist/fonts)
const fontsDist = join(root, 'dist', 'fonts');
mkdirSync(fontsDist, { recursive: true });
for (const name of readdirSync(join(root, 'src', 'fonts'))) {
  copyFileSync(join(root, 'src', 'fonts', name), join(fontsDist, name));
}
console.log('assets copied');
