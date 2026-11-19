import { execSync } from 'node:child_process';
import { build } from 'esbuild';
import { mkdirSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

const root = dirname(new URL(import.meta.url).pathname);
const outClient = join(root, 'build');
mkdirSync(outClient, { recursive: true });

execSync('npx tsc -p tsconfig.json --noEmit', { cwd: root, stdio: 'inherit' });
execSync('npx tsc -p tsconfig.server.json', { cwd: root, stdio: 'inherit' });

copyFileSync(join(root, 'client', 'lib', 'styles.css'), join(outClient, 'styles.css'));
copyFileSync(join(root, 'client', 'index.html'), join(outClient, 'index.html'));

await build({
  entryPoints: [join(root, 'client', 'main.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome118', 'firefox118', 'safari17'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outdir: outClient,
  splitting: false,
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

mkdirSync(join(outClient, 'fonts'), { recursive: true });
const fontPkgs = ['ibm-plex-sans', 'ibm-plex-sans-condensed', 'ibm-plex-mono'];
const weights = ['400', '500', '600', '700'];
for (const pkg of fontPkgs) {
  const dir = join(root, 'node_modules', '@fontsource', pkg, 'files');
  for (const f of readdirSync(dir)) {
    if (f.endsWith('.woff2') && (f.includes('-latin-') || f.includes('-latin-ext-')) && weights.some(w => f.includes(`-${w}-`))) {
      copyFileSync(join(dir, f), join(outClient, 'fonts', f));
    }
  }
}

const iconDir = join(root, 'node_modules', 'lucide-static', 'icons');
mkdirSync(join(outClient, 'icons'), { recursive: true });
const wanted = ['folder', 'file-text', 'file', 'image', 'lock', 'unlock', 'upload', 'download', 'share-2', 'trash-2', 'history', 'inbox', 'settings', 'search', 'grid', 'list', 'chevron-right', 'chevron-down', 'x', 'plus', 'menu', 'arrow-right', 'check', 'alert-triangle', 'more-horizontal', 'pencil', 'move', 'clock', 'users', 'log-out', 'sun'];
for (const name of wanted) {
  const f = join(iconDir, `${name}.svg`);
  if (statSync(f, { throwIfNoEntry: false })) copyFileSync(f, join(outClient, 'icons', `${name}.svg`));
}

console.log('Build complete.');
