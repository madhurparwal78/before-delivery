import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/server', { recursive: true });
mkdirSync('dist/client', { recursive: true });
mkdirSync('public/assets/fonts', { recursive: true });

execSync('npx tsc --noEmit', { stdio: 'inherit' });

execSync('npx esbuild src/server/main.ts --bundle --platform=node --format=esm --target=node22 --outfile=dist/server/main.js --external:minio --external:argon2 --external:pg --external:jsonwebtoken', { stdio: 'inherit' });
execSync('npx esbuild src/client/app.ts --bundle --format=iife --target=es2022 --outfile=dist/client/app.js', { stdio: 'inherit' });
execSync('npx esbuild src/client/styles.css --outfile=dist/client/styles.css --loader:.css=css', { stdio: 'inherit' });

copyFileSync('dist/client/app.js', 'public/assets/app.js');
copyFileSync('dist/client/styles.css', 'public/assets/styles.css');
for (const font of ['eb-garamond-latin-400-normal.woff2', 'eb-garamond-latin-400-italic.woff2', 'eb-garamond-latin-600-normal.woff2']) {
  copyFileSync(join('assets/fonts', font), join('public/assets/fonts', font));
}
writeFileSync('public/assets/slab.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200" role="img" aria-label="A player message seen through Tamperglass">
  <rect x="20" y="20" width="360" height="160" fill="#1E4C8F" opacity="0.28"/>
  <text x="48" y="78" fill="#24241C" font-size="24" font-style="italic">i never got the lantern pack</text>
  <text x="48" y="112" fill="#24241C" font-size="17">signature valid</text>
  <text x="48" y="136" fill="#24241C" font-size="17">7 of 8</text>
  <text x="48" y="160" fill="#24241C" font-size="17">nothing removed</text>
  <text x="48" y="184" fill="#24241C" font-size="17">no link</text>
</svg>
`);
writeFileSync('public/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hushline</title>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<div id="root"></div>
<script src="/assets/app.js"></script>
</body>
</html>
`);
console.log('build complete');
