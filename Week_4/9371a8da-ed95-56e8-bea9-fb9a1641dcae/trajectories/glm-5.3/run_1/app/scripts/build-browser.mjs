import { build } from 'esbuild';

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
};

await build({
  ...common,
  entryPoints: ['src/browser/main.ts'],
  outfile: 'public/app.js',
});
