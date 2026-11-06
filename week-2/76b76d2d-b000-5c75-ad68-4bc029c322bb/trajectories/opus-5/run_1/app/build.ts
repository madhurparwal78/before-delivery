import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const out = 'dist';

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/public/fonts`, { recursive: true });

await build({
  entryPoints: ['src/server/main.ts'],
  outfile: `${out}/server.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['pg'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

await build({
  entryPoints: ['src/client/main.ts'],
  outfile: `${out}/public/app.js`,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'iife',
  minify: true,
});

await build({
  entryPoints: ['src/client/styles.css'],
  outfile: `${out}/public/app.css`,
  bundle: true,
  external: ['/fonts/*'],
  minify: true,
});

const fonts: Array<[string, string]> = [
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2'],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2'],
  ['@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', 'instrument-serif-400.woff2'],
  ['@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-400.woff2'],
];
for (const [spec, name] of fonts) {
  await cp(require_.resolve(spec), `${out}/public/fonts/${name}`);
}

const icons = ['aperture', 'armchair', 'calendar-days', 'check', 'circle-alert', 'film', 'menu', 'ticket', 'x'];
await mkdir(`${out}/public/icons`, { recursive: true });
for (const icon of icons) {
  await cp(require_.resolve(`lucide-static/icons/${icon}.svg`), `${out}/public/icons/${icon}.svg`);
}

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
await writeFile(`${out}/public/version.txt`, `${pkg.version}\n`, 'utf8');
