import { build } from 'esbuild';
// @ts-nocheck
import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync, existsSync, cpSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const dist = join(root, 'dist');
const distPublic = join(dist, 'public');
mkdirSync(distPublic, { recursive: true });
mkdirSync(join(distPublic, 'assets'), { recursive: true });

// server bundle (with shared domain)
await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(dist, 'server/index.js'),
  external: ['pg', 'pg-native', '@aws-sdk/*'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: 'none',
});

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(dist, 'server/index.js'),
  external: ['pg', 'pg-native', '@aws-sdk/*'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: 'none',
});

// browser bundle
const icons = {};
const iconDir = join(root, 'node_modules/lucide-static/icons');
for (const name of ['lock', 'scissors', 'link-2', 'triangle-alert', 'unplug', 'circle-check', 'file-text', 'search', 'plus', 'copy', 'x', 'eye', 'pencil', 'book-open', 'history', 'network', 'share-2', 'cloud-off', 'cloud-upload', 'rotate-ccw', 'send', 'log-in', 'log-out', 'user', 'menu', 'chevron-right', 'chevron-left', 'arrow-right', 'refresh-cw', 'shield', 'server', 'inbox', 'ban', 'key-round', 'wifi-off', 'folder', 'settings', 'external-link']) {
  const p = join(iconDir, `${name}.svg`);
  if (existsSync(p)) {
    let svg = readFileSync(p, 'utf8');
    svg = svg.replace('<!--tabler-->', '').replace(/<svg /, '<svg aria-hidden="true" ');
    icons[name] = svg.replace(/\n/g, '');
  }
}
writeFileSync(join(root, 'src/browser/icons.json'), JSON.stringify(icons));

await build({
  entryPoints: [join(root, 'src/browser/main.ts')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: join(distPublic, 'assets/app.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// public assets
copyFileSync(join(root, 'src/browser/app.css'), join(distPublic, 'assets/app.css'));
copyFileSync(join(root, 'public/fonts.css'), join(distPublic, 'assets/fonts.css'));
cpSync(join(root, 'public/fonts'), join(distPublic, 'assets/fonts'), { recursive: true });
if (existsSync(join(root, 'public/assets/reader.css'))) {
  copyFileSync(join(root, 'public/assets/reader.css'), join(distPublic, 'assets/reader.css'));
}
// index.html shell
const html = readFileSync(join(root, 'src/browser/shell.html'), 'utf8');
writeFileSync(join(distPublic, 'index.html'), html);
console.log('build complete');
