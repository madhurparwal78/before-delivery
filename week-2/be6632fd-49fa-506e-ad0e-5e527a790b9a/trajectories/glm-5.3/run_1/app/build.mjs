import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync, readdirSync, rmSync } from 'node:fs';

mkdirSync('public/assets', { recursive: true });

// Compile the server into dist, then bundle the client with esbuild.
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
execSync('./node_modules/.bin/tsc --project tsconfig.build.json', { stdio: 'inherit' });
execSync('./node_modules/.bin/esbuild src/client/main.ts --bundle --format=esm --outfile=public/assets/app.js --target=es2020 --minify', { stdio: 'inherit' });

copyFileSync('src/client/styles.css', 'public/assets/styles.css');
if (!existsSync('public/index.html')) {
  console.error('missing public/index.html');
  process.exit(1);
}
const fonts = readdirSync('public/assets').filter(f => f.endsWith('.woff2'));
if (fonts.length < 4) {
  console.error('missing bundled fonts');
  process.exit(1);
}
console.log('build complete');
