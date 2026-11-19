import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'public', 'assets'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/server/index.ts')],
  outdir: join(dist, 'server'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
});

await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(dist, 'public', 'assets', 'desk.js'),
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
});

// Jost ships from the app's own files (OFL-1.1); latin subset only.
const fontDir = join(root, 'node_modules/@fontsource/jost/files');
const weights = [400, 500, 600, 700];
let faces = '';
for (const w of weights) {
  const name = `jost-latin-${w}-normal.woff2`;
  await cp(join(fontDir, name), join(dist, 'public', 'assets', name));
  faces += `@font-face{font-family:Jost;font-style:normal;font-weight:${w};font-display:swap;src:url(/assets/${name}) format('woff2');}\n`;
}

const css = await readFile(join(root, 'src/client/styles.css'), 'utf8');
await writeFile(join(dist, 'public', 'assets', 'desk.css'), faces + css, 'utf8');

console.log('build complete');
