import { build } from 'esbuild';

await build({
  entryPoints: ['dist/client/main.js'],
  bundle: true,
  format: 'esm',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: 'public/app.js',
  legalComments: 'none',
  minify: true
});
