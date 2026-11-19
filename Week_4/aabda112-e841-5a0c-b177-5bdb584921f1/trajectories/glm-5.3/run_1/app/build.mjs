import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });
fs.mkdirSync(path.join(dist, 'public'), { recursive: true });

// fonts are bundled with the app and served from the same origin
fs.cpSync(path.join(root, 'fonts'), path.join(dist, 'fonts'), { recursive: true });

// server: bundle the TypeScript sources into one runnable file
const result = await build({
  entryPoints: [path.join(root, 'server', 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(dist, 'server.js'),
  loader: { '.ts': 'ts', '.js': 'ts' },
  packages: 'external',
  sourcemap: false,
  logLevel: 'error',
  banner: {
    js: `import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);`,
  },
});
if (result.errors && result.errors.length) process.exit(1);

// frontend: bundle the client entry
await build({
  entryPoints: [path.join(root, 'client', 'src', 'main.ts')],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: path.join(dist, 'public', 'app.js'),
  sourcemap: false,
  logLevel: 'error',
  minify: false,
});

fs.copyFileSync(path.join(root, 'client', 'index.html'), path.join(dist, 'public', 'index.html'));
fs.copyFileSync(path.join(root, 'client', 'styles.css'), path.join(dist, 'public', 'styles.css'));

console.log('build done');
