import { mkdirSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { build } from 'esbuild';

const outdir = 'dist';

mkdirSync(`${outdir}/ui`, { recursive: true });
copyFileSync('ui-src/index.html', `${outdir}/ui/index.html`);

await build({
  entryPoints: ['ui-src/main.ts'],
  bundle: true,
  outfile: `${outdir}/ui/app.js`,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  minify: true,
  sourcemap: false,
});

if (existsSync('ui-src/styles/app.css')) {
  copyFileSync('ui-src/styles/app.css', `${outdir}/ui/app.css`);
}

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  outfile: `${outdir}/server.js`,
  format: 'esm',
  packages: 'external',
  sourcemap: false,
  banner: {
    js: [
      `import { createRequire as __createRequire } from 'node:module';`,
      `const require = __createRequire(import.meta.url);`,
      `const __dirname = new URL('.', import.meta.url).pathname;`,
    ].join('\n'),
  },
});

mkdirSync(`${outdir}/ui/assets`, { recursive: true });
for (const f of readdirSync('ui-src/fonts')) {
  copyFileSync(`ui-src/fonts/${f}`, `${outdir}/ui/assets/${f}`);
}
console.log('build complete');

