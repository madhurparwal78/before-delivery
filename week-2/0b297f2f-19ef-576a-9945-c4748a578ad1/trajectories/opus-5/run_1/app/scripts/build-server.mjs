import { build } from 'esbuild';

await build({
  entryPoints: ['src/server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  external: ['pg', 'pg-native'],
  logLevel: 'info',
});
