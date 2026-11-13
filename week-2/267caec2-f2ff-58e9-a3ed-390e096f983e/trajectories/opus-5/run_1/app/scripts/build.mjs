import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const web = path.join(dist, 'web');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(web, 'fonts'), { recursive: true });

execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

await build({
  entryPoints: [path.join(root, 'src/client/main.tsx')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  minify: true,
  outfile: path.join(web, 'app.js'),
  loader: { '.svg': 'text' },
});

await build({
  entryPoints: [path.join(root, 'src/client/styles.css')],
  bundle: true,
  minify: true,
  external: ['/fonts/*'],
  outfile: path.join(web, 'app.css'),
});

const fonts = [
  ['@fontsource-variable/archivo/files/archivo-latin-standard-normal.woff2', 'archivo-variable.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'plex-mono-600.woff2'],
];
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(web, 'fonts', to));
}

await cp(path.join(root, 'src/client/index.html'), path.join(web, 'index.html'));
await writeFile(path.join(dist, 'server', 'schema.sql'), await readFile(path.join(root, 'src/server/schema.sql')));
