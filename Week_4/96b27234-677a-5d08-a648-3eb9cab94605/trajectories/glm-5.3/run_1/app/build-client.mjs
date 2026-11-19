import fs from 'fs';
import esbuild from 'esbuild';

fs.mkdirSync('dist/public', { recursive: true });
fs.cpSync('src/public', 'dist/public', { recursive: true });

const entryPoints = ['main'].map((n) => `src/client/${n}.ts`);
esbuild.build({
  entryPoints,
  outdir: 'dist/public/js',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  logLevel: 'warning',
});
console.log('client built');
