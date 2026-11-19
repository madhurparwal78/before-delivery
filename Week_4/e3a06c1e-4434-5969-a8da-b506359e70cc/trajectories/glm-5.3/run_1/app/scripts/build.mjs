import { build, context } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (p) => path.join(root, 'src-browser', p);
const outBrowser = path.join(root, 'dist-browser');
const outServer = path.join(root, 'dist-server');

const entryPoints = [
  { in: src('boot.ts'), out: 'app' },
];

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  legalComments: 'none',
  minify: true,
  loader: { '.woff2': 'file' },
  publicPath: '/assets/',
  assetNames: 'assets/[name]-[hash]',
  define: { 'import.meta.env': JSON.stringify({ DEV: process.argv.includes('--dev') }) },
};

async function buildBrowser() {
  await rm(outBrowser, { recursive: true, force: true });
  await mkdir(outBrowser, { recursive: true });
  const results = await Promise.all(entryPoints.map((e) => build({ ...common, entryPoints: [e.in], outfile: path.join(outBrowser, `${e.out}.js`) })));
  const assets = [];
  for (const r of results) for (const f of r.outputFiles ?? []) assets.push(f.path);
  await cp(path.join(root, 'public'), outBrowser, { recursive: true });
  return assets;
}

async function buildServer() {
  await rm(outServer, { recursive: true, force: true });
  await mkdir(outServer, { recursive: true });
  await build({
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    legalComments: 'none',
    minify: false,
    entryPoints: [path.join(root, 'src-server', 'main.ts')],
    outfile: path.join(outServer, 'main.cjs'),
    // pg is loaded from node_modules at runtime (native require chain), the rest bundles.
    external: ['pg', 'pg-connection-string', 'pg-pool', 'pg-types', 'pg-protocol'],
  });
}

if (process.argv.includes('--clean-only')) {
  await rm(outBrowser, { recursive: true, force: true });
  await rm(outServer, { recursive: true, force: true });
  process.exit(0);
}

await buildServer();
  await buildBrowser();
  console.log('build complete');
