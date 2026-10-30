// Bundle the server (TypeScript for NestJS decorators) into one CommonJS file.
// CommonJS-backed packages stay external; the app's own sources (and the
// preact stack the page renderer needs) are bundled in.
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/server/main.cjs',
  external: [
    '@nestjs/common', '@nestjs/core', '@nestjs/platform-express',
    'pg', 'nodemailer', 'bcryptjs', 'cookie-parser', 'reflect-metadata', 'rxjs',
  ],
  sourcemap: false,
  logLevel: 'info',
});
console.log('[server] bundled to dist/server/main.cjs');


