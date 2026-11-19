import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';

await mkdir('public/assets', { recursive: true });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'public/assets/app.js',
  minify: true,
  sourcemap: false,
  logLevel: 'info',
});

await copyFile('src/client/app.css', 'public/assets/app.css');

const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 180" width="1100" height="180" role="img" aria-label="Ridgestack neon wordmark">
<defs>
<filter id="neon" x="-20%" y="-60%" width="140%" height="220%">
<feGaussianBlur stdDeviation="10" result="wide" />
<feGaussianBlur stdDeviation="3" result="tight" />
<feMerge><feMergeNode in="wide" /><feMergeNode in="tight" /><feMergeNode in="SourceGraphic" /></feMerge>
</filter>
</defs>
<rect width="1100" height="180" fill="#08090c" />
<g filter="url(#neon)">
<text x="550" y="130" text-anchor="middle" font-family="'Inter Tight', Inter, sans-serif" font-size="140"
  fill="none" stroke="#ffffff" stroke-width="3" letter-spacing="2">Ridgestack</text>
</g>
</svg>
`;
await writeFile('public/assets/wordmark.svg', wordmark);
