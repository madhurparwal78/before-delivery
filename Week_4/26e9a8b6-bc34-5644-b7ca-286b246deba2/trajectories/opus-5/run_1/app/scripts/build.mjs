import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const shared = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  loader: { '.sql': 'text', '.css': 'text' },
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: [join(root, 'src/server/index.ts')],
  outfile: join(dist, 'server/index.js'),
  platform: 'node',
  packages: 'external',
  banner: {
    js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);",
  },
});

await build({
  ...shared,
  entryPoints: [join(root, 'src/tools/generate-samples.ts')],
  outfile: join(dist, 'tools/generate-samples.js'),
  platform: 'node',
  packages: 'external',
});

await build({
  ...shared,
  entryPoints: [join(root, 'src/client/main.ts')],
  outfile: join(dist, 'public/app.js'),
  platform: 'browser',
  minify: true,
  sourcemap: false,
});

cpSync(join(root, 'public'), join(dist, 'public'), { recursive: true });

execFileSync(process.execPath, [join(dist, 'tools/generate-samples.js'), join(dist, 'public/samples')], {
  stdio: 'inherit',
});
