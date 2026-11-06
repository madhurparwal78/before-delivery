import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');
const fontDir = join(publicDir, 'assets/fonts');

rmSync(dist, { recursive: true, force: true });
mkdirSync(fontDir, { recursive: true });

const npx = (args) =>
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: root, stdio: 'inherit' });

npx(['tsc', '-p', 'tsconfig.json', '--noEmit']);
npx(['tsc', '-p', 'tsconfig.server.json']);

await esbuild.build({
  entryPoints: [join(root, 'src/client/main.tsx')],
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: join(publicDir, 'app.js'),
  logLevel: 'info',
});

await esbuild.build({
  entryPoints: [join(root, 'src/client/styles/app.css')],
  bundle: true,
  external: ['/assets/*'],
  minify: true,
  outfile: join(publicDir, 'app.css'),
  logLevel: 'info',
});

const fonts = [
  ['@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2', 'space-grotesk-400.woff2'],
  ['@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2', 'space-grotesk-600.woff2'],
  ['@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2', 'space-grotesk-700.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 'ibm-plex-mono-600.woff2'],
];
for (const [from, to] of fonts) {
  cpSync(join(root, 'node_modules', from), join(fontDir, to));
}

const html = readFileSync(join(root, 'src/client/index.html'), 'utf8');
writeFileSync(join(publicDir, 'index.html'), html);
cpSync(join(root, 'src/client/sw.js'), join(publicDir, 'sw.js'));

console.log('build complete');
