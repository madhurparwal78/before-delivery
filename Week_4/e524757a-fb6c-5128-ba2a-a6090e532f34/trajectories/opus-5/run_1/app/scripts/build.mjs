import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/public/fonts', { recursive: true });

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  loader: { '.sql': 'text' },
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});

await build({
  entryPoints: { app: 'src/client/main.ts' },
  outdir: 'dist/public',
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  minify: true,
});

await cp('src/public', 'dist/public', { recursive: true });

for (const weight of ['400', '500', '700']) {
  await cp(
    `node_modules/@fontsource/albert-sans/files/albert-sans-latin-${weight}-normal.woff2`,
    `dist/public/fonts/albert-sans-${weight}.woff2`,
  );
}

console.log('build complete');
