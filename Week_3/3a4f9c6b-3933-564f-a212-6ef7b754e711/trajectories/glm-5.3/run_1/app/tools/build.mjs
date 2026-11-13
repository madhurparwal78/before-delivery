// Build script: compile TypeScript server, bundle the client, copy static assets.
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist/server'), { recursive: true });
mkdirSync(join(root, 'dist/client'), { recursive: true });

const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Keelson</title>
<link rel="stylesheet" href="/app.css">
<link rel="preload" href="/fonts/SpaceGrotesk-VF.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/fonts/IBMPlexSans-VF.ttf" as="font" type="font/ttf" crossorigin>
<link rel="preload" href="/fonts/IBMPlexMono-Regular.ttf" as="font" type="font/ttf" crossorigin>
</head>
<body>
<div id="root"></div>
<script src="/app.js"></script>
</body>
</html>
`;

// Server: bundle to plain JS, keep schema.sql beside it.
await build({
  entryPoints: [join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(root, 'dist/server/main.js'),
  packages: 'external',
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  sourcemap: false,
  legalComments: 'none',
});
cpSync(join(root, 'src/server/schema.sql'), join(root, 'dist/server/schema.sql'));

// Client: bundle the whole app into one JS file.
await build({
  entryPoints: [join(root, 'src/client/main.ts')],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: join(root, 'dist/client/app.js'),
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});

// Styles: esbuild handles nesting/custom properties; copy as CSS.
await build({
  entryPoints: [join(root, 'src/client/styles.css')],
  outfile: join(root, 'dist/client/app.css'),
  minify: true,
});

// Static assets: fonts and their licence texts.
mkdirSync(join(root, 'dist/client/fonts'), { recursive: true });
cpSync(join(root, 'public/fonts'), join(root, 'dist/client/fonts'), { recursive: true });

// Index page.
writeFileSync(join(root, 'dist/client/index.html'), INDEX_HTML);

console.log('build complete');
