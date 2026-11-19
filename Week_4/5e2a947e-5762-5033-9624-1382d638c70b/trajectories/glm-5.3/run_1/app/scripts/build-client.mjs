import { build } from 'esbuild';
import { mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

mkdirSync(path.join(root, 'client'), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'src/client/main.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  outfile: path.join(root, 'client/app.js'),
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

if (!result) process.exit(1);

// Copy the public assets (styles, fonts, index shell).
const copyDir = (from, to) => {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const src = path.join(from, entry);
    const dst = path.join(to, entry);
    if (statSync(src).isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
};
copyDir(path.join(root, 'src/client/styles'), path.join(root, 'client/styles'));
copyFileSync(path.join(root, 'src/client/index.html'), path.join(root, 'client/index.html'));
copyDir(path.join(root, 'src/client/fonts'), path.join(root, 'client/fonts'));
console.log('client built');
