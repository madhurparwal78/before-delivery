import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const outdir = 'dist/client';
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  outfile: join(outdir, 'app.js'),
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
});

// bundle the Lucide error icon for refused fields, as a data URI
const { readFileSync, writeFileSync } = await import('node:fs');
let iconsCss = '';
try {
  const icon = readFileSync('node_modules/lucide-static/icons/alert-circle.svg', 'utf8');
  const encoded = Buffer.from(icon).toString('base64');
  iconsCss = `.field-error::before { content: none; }
.field-error { padding-left: 24px; background-image: url(data:image/svg+xml;base64,${encoded}); background-repeat: no-repeat; background-position: left center; background-size: 16px 16px; }`;
  writeFileSync(join(outdir, 'lucide.css'), iconsCss);
} catch {
  // the icon is optional when the package layout differs
}
copyFileSync('src/client/index.html', join(outdir, 'index.html'));
copyFileSync('src/client/styles.css', join(outdir, 'styles.css'));
copyFileSync('src/client/fonts.css', join(outdir, 'fonts.css'));
if (existsSync('public/fonts')) {
  for (const file of ['InstrumentSerif-Regular.ttf', 'IBMPlexSans-Regular.ttf', 'IBMPlexMono-Regular.ttf', 'OFL.txt']) {
    try {
      copyFileSync(join('public/fonts', file), join(outdir, file));
    } catch {
      // a missing optional file is fine
    }
  }
}
console.log('client built');
