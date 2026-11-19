import { build } from 'esbuild';
import { cp, mkdir, rm, readdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const pub = path.join(dist, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(pub, { recursive: true });

await build({
  entryPoints: [path.join(root, 'src/server/server.ts')],
  outfile: path.join(dist, 'server.js'),
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  bundle: true,
  sourcemap: false,
  external: ['pg', 'pg-native', 'meilisearch', 'draco3d'],
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  outfile: path.join(pub, 'app.js'),
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await build({
  entryPoints: [path.join(root, 'src/client/styles.css')],
  outfile: path.join(pub, 'app.css'),
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  logLevel: 'info',
});

// Self-hosted fonts (OFL-1.1).
const fontDir = path.join(pub, 'fonts');
await mkdir(fontDir, { recursive: true });
for (const [pkg, family] of [
  ['@fontsource/red-hat-display', 'red-hat-display'],
  ['@fontsource/red-hat-text', 'red-hat-text'],
]) {
  const files = path.join(root, 'node_modules', pkg, 'files');
  for (const name of await readdir(files)) {
    if (!name.startsWith(`${family}-latin-`)) continue;
    if (!/-(400|500|700|900)-normal\.woff2$/.test(name)) continue;
    await cp(path.join(files, name), path.join(fontDir, name));
  }
}

// Draco decoder for GLTFLoader (Apache-2.0, shipped with three).
const dracoSrc = path.join(root, 'node_modules/three/examples/jsm/libs/draco');
const dracoOut = path.join(pub, 'draco');
await mkdir(dracoOut, { recursive: true });
for (const name of ['draco_wasm_wrapper.js', 'draco_decoder.wasm']) {
  await cp(path.join(dracoSrc, name), path.join(dracoOut, name));
}

// Lucide icon sprite (ISC): only the icons the app uses.
const iconNames = [
  'check', 'x', 'copy', 'chevron-left', 'chevron-right', 'search',
  'arrow-right', 'clock', 'camera', 'triangle-alert', 'link',
];
const symbols = [];
for (const name of iconNames) {
  const svg = await readFile(path.join(root, 'node_modules/lucide-static/icons', `${name}.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  symbols.push(`<symbol id="i-${name}" viewBox="0 0 24 24">${inner}</symbol>`);
}
await writeFile(
  path.join(pub, 'icons.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols.join('')}</svg>`,
);

console.log('build complete');
