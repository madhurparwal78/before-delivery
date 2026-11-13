import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const common = { bundle: true, format: 'esm', platform: 'node', target: 'node22', sourcemap: false, logLevel: 'warning' };

mkdirSync('dist/server', { recursive: true });
mkdirSync('public/fonts', { recursive: true });

await build({
  ...common,
  entryPoints: ['src/server/main.ts'],
  outfile: 'dist/server/main.js',
  external: ['three'],
});

// The browser bundle and the stylesheet are served from public/.
await build({
  ...common,
  entryPoints: ['src/client/main.ts'],
  outfile: 'public/main.js',
  minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
});

const css = readFileSync('src/client/styles.css', 'utf8');
const fontFace = `
@font-face { font-family: 'Instrument Serif'; src: url('/fonts/InstrumentSerif-Regular.ttf') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: 'Inter Tight'; src: url('/fonts/InterTight-var.ttf') format('truetype'); font-weight: 100 900; font-style: normal; font-display: swap; }
@font-face { font-family: 'JetBrains Mono'; src: url('/fonts/JetBrainsMono-var.ttf') format('truetype'); font-weight: 100 800; font-style: normal; font-display: swap; }
`;
writeFileSync('public/main.css', fontFace + css);

copyFileSync('assets/fonts/InstrumentSerif-Regular.ttf', 'public/fonts/InstrumentSerif-Regular.ttf');
copyFileSync('assets/fonts/InterTight-var.ttf', 'public/fonts/InterTight-var.ttf');
copyFileSync('assets/fonts/JetBrainsMono-var.ttf', 'public/fonts/JetBrainsMono-var.ttf');

console.log('build complete');
