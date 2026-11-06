import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outPublic = path.join(root, 'dist', 'public');

const fonts = [
  ['@fontsource/newsreader/files/newsreader-latin-400-normal.woff2', 'newsreader-400.woff2'],
  ['@fontsource/newsreader/files/newsreader-latin-400-italic.woff2', 'newsreader-400-italic.woff2'],
  ['@fontsource/newsreader/files/newsreader-latin-600-normal.woff2', 'newsreader-600.woff2'],
  ['@fontsource/newsreader/files/newsreader-latin-700-normal.woff2', 'newsreader-700.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2', 'source-serif-4-400.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2', 'source-serif-4-400-italic.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2', 'source-serif-4-600.woff2'],
  ['@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2', 'source-serif-4-700.woff2'],
];

const icons = ['bold', 'italic', 'underline', 'link', 'message-square', 'search', 'check-check', 'x', 'menu', 'list', 'users'];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quillmere Drafts</title>
<link rel="stylesheet" href="/assets/app.css">
<script type="module" src="/assets/app.js"></script>
</head>
<body>
<div id="root"></div>
</body>
</html>
`;

await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(outPublic, 'fonts'), { recursive: true });

const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync('node', [tsc, '-p', 'tsconfig.json', '--noEmit'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [tsc, '-p', 'tsconfig.client.json', '--noEmit'], { cwd: root, stdio: 'inherit' });

await build({
  entryPoints: [path.join(root, 'src', 'server', 'index.ts')],
  outfile: path.join(root, 'dist', 'server', 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: [path.join(root, 'src', 'client', 'main.ts'), path.join(root, 'src', 'client', 'app.css')],
  outdir: path.join(outPublic, 'assets'),
  entryNames: 'app',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
  sourcemap: false,
  external: ['/fonts/*'],
  logLevel: 'warning',
});

await mkdir(path.join(outPublic, 'icons'), { recursive: true });
for (const name of icons) {
  await cp(path.join(root, 'node_modules', 'lucide-static', 'icons', `${name}.svg`), path.join(outPublic, 'icons', `${name}.svg`));
}
for (const [from, to] of fonts) {
  await cp(path.join(root, 'node_modules', from), path.join(outPublic, 'fonts', to));
}
await writeFile(path.join(outPublic, 'index.html'), html);
