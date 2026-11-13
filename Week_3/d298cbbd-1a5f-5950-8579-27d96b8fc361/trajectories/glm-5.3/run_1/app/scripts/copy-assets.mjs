import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/public', { recursive: true });
for (const asset of ['public/app.css', 'public/bodoni-moda-400.woff2', 'public/bodoni-moda-700.woff2', 'public/jost-400.woff2', 'public/jost-600.woff2', 'public/favicon.svg']) {
  cpSync(asset, `dist/public/${asset.split('/').pop()}`);
}
