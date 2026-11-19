import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const outDir = 'dist';
const publicDir = `${outDir}/public`;

await rm(outDir, { recursive: true, force: true });
await mkdir(`${publicDir}/fonts`, { recursive: true });

await build({
  entryPoints: ['src/server/server.ts'],
  outfile: `${outDir}/server.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg'],
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: `${publicDir}/app.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/workers/geometry.worker.ts'],
  outfile: `${publicDir}/geometry-worker.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  logLevel: 'info',
});

await cp('src/client/styles.css', `${publicDir}/styles.css`);

await cp('assets/fonts', `${publicDir}/fonts`, { recursive: true });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quarkyard — make a thing you can hold by Friday</title>
    <meta name="description" content="Quarkyard is a browser maker studio for after-school STEM classrooms: 3D Workshop, Circuit Bench and Block Lab." />
    <link rel="preload" href="/fonts/fira-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/fira-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body>
    <div id="qy-app"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;
await writeFile(`${publicDir}/index.html`, html, 'utf8');

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#1552f0" />
  <path d="M8 20 16 8l8 12z" fill="#ffffff" />
  <circle cx="16" cy="22" r="3" fill="#f08a24" />
</svg>
`;
await writeFile(`${publicDir}/favicon.svg`, favicon, 'utf8');

process.stdout.write('[quarkyard] build complete\n');
