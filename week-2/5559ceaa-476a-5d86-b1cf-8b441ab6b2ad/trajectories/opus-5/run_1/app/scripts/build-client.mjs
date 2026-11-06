import { build } from 'esbuild';
import { chmod, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist/public');

const fonts = [
  ['@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2', 'playfair-400.woff2'],
  ['@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2', 'playfair-700.woff2'],
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2'],
  ['@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', 'mono-400.woff2'],
];

const page = (title, script) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<div id="root"></div>
<script type="module" src="/assets/${script}"></script>
</body>
</html>
`;

await mkdir(resolve(out, 'assets/fonts'), { recursive: true });

await build({
  entryPoints: {
    app: resolve(root, 'src/client/app.ts'),
    review: resolve(root, 'src/client/review.ts'),
  },
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  minify: true,
  outdir: resolve(out, 'assets'),
  entryNames: '[name]',
});

await cp(resolve(root, 'src/client/app.css'), resolve(out, 'assets/app.css'));
await chmod(resolve(out, 'assets/app.css'), 0o644);

for (const [from, to] of fonts) {
  const target = resolve(out, 'assets/fonts', to);
  await cp(resolve(root, 'node_modules', from), target);
  await chmod(target, 0o644);
}

await writeFile(resolve(out, 'index.html'), page('Relay Bench', 'app.js'));
await writeFile(resolve(out, 'review.html'), page('Checkpoint review — Relay Bench', 'review.js'));

const schema = await readFile(resolve(root, 'src/server/schema.sql'), 'utf8');
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await writeFile(resolve(root, 'dist/server/schema.sql'), schema);
