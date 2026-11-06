import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = dirname(import.meta.dirname);
const dist = join(root, 'dist');
rmSync(dist, { recursive: true, force: true });

execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
});

await build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
  outfile: join(dist, 'public', 'app.js'),
});

const fonts = [
  ['@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2', 'space-grotesk-400.woff2'],
  ['@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2', 'space-grotesk-500.woff2'],
  ['@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2', 'space-grotesk-700.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-400.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2', 'ibm-plex-sans-500.woff2'],
  ['@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-600.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 'ibm-plex-mono-500.woff2'],
];
mkdirSync(join(dist, 'public', 'fonts'), { recursive: true });
for (const [from, to] of fonts) {
  cpSync(join(root, 'node_modules', from), join(dist, 'public', 'fonts', to));
}

cpSync(join(root, 'src', 'client', 'styles.css'), join(dist, 'public', 'styles.css'));
cpSync(join(root, 'src', 'client', 'index.html'), join(dist, 'public', 'index.html'));
cpSync(join(root, 'src', 'server', 'db', 'schema.sql'), join(dist, 'server', 'db', 'schema.sql'));
cpSync(join(root, 'src', 'server', 'billing', 'catalog.xml'), join(dist, 'server', 'billing', 'catalog.xml'));

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(dist, 'build-info.json'), JSON.stringify({ version: pkg.version }));
console.log('build complete');
