import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  outfile: 'public/client.js',
});

console.log('client bundle written');
