import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/assets', { recursive: true });
await cp('public', 'dist/public', { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
});

await build({
  entryPoints: { app: 'src/client/main.tsx' },
  outdir: 'dist/public/assets',
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox121', 'safari17'],
  jsx: 'automatic',
  minify: true,
  loader: { '.css': 'css' },
  external: ['/fonts/*'],
  define: { 'process.env.NODE_ENV': '"production"' },
});

const shellFiles = ['/assets/app.js', '/assets/app.css', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
for (const font of await readdir('public/fonts')) shellFiles.push(`/fonts/${font}`);
const hash = createHash('sha256');
for (const file of shellFiles) hash.update(await readFile(`dist/public${file}`));

await build({
  entryPoints: { sw: 'src/client/sw.ts' },
  outdir: 'dist/public',
  bundle: true,
  format: 'iife',
  target: ['chrome120', 'firefox121', 'safari17'],
  minify: true,
  define: {
    worker: 'self',
    SHELL_VERSION: JSON.stringify(hash.digest('hex').slice(0, 12)),
    SHELL_FILES: JSON.stringify(['/shell', ...shellFiles]),
  },
});
await writeFile('dist/build.json', JSON.stringify({ builtAt: new Date().toISOString() }));
