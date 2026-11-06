import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'dist', 'public');

execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.client.json'], {
  cwd: root,
  stdio: 'inherit',
});

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'assets'), { recursive: true });
mkdirSync(join(outDir, 'fonts'), { recursive: true });

await build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outfile: join(outDir, 'assets', 'app.js'),
});

cpSync(join(root, 'src', 'client', 'app.css'), join(outDir, 'assets', 'app.css'));

const fonts = [
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-italic.woff2'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-600-normal.woff2'],
  ['@fontsource/ibm-plex-sans-condensed', 'ibm-plex-sans-condensed-latin-400-normal.woff2'],
  ['@fontsource/ibm-plex-sans-condensed', 'ibm-plex-sans-condensed-latin-600-normal.woff2'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono-latin-400-normal.woff2'],
];
for (const [pkg, file] of fonts) {
  const from = join(root, 'node_modules', pkg, 'files', file);
  if (!existsSync(from)) throw new Error(`missing font file ${file}`);
  cpSync(from, join(outDir, 'fonts', file));
}

console.log('client build complete');
