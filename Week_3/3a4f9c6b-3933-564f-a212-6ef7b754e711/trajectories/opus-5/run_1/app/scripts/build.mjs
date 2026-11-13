import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const publicDir = new URL('public/', dist);

await rm(dist, { recursive: true, force: true });
await mkdir(publicDir, { recursive: true });

await build({
  entryPoints: [new URL('src/server/index.ts', root).pathname],
  outfile: new URL('server.js', dist).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  minify: false,
  banner: {
    js: "import{createRequire as __keelsonRequire}from'node:module';const require=__keelsonRequire(import.meta.url);",
  },
});

await build({
  entryPoints: [new URL('src/client/main.ts', root).pathname],
  outfile: new URL('app.js', publicDir).pathname,
  bundle: true,
  platform: 'browser',
  target: ['chrome120', 'firefox120', 'safari17'],
  format: 'esm',
  sourcemap: false,
  minify: true,
});

// The stylesheet is minified but not bundled, so its absolute font URLs stay as written.
await build({
  entryPoints: [new URL('src/client/styles.css', root).pathname],
  outfile: new URL('styles.css', publicDir).pathname,
  bundle: false,
  minify: true,
});

await cp(new URL('static/fonts/', root), publicDir, { recursive: true });
await cp(new URL('src/client/index.html', root), new URL('index.html', publicDir));

await writeFile(new URL('.gitignore', dist), '*\n');
process.stdout.write('Keelson build complete\n');
