// Tool script: bundles the client, copies the stylesheet and the bundled fonts.
import { build } from 'esbuild';
import { cpSync, mkdirSync, readdirSync } from 'node:fs';

mkdirSync('public/assets', { recursive: true });

await build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['chrome120', 'firefox120', 'safari17'],
  outfile: 'public/assets/app.js',
  legalComments: 'none',
});

cpSync('src/client/app.css', 'public/assets/app.css');

mkdirSync('public/assets/fonts', { recursive: true });
const fontPackages = [
  { name: '@fontsource/bricolage-grotesque', weights: [400, 600, 700] },
  { name: '@fontsource/ibm-plex-sans', weights: [400, 600] },
  { name: '@fontsource/ibm-plex-mono', weights: [400, 600] },
];
for (const pkg of fontPackages) {
  const dir = `node_modules/${pkg.name}/files`;
  for (const file of readdirSync(dir)) {
    const match = /^.*-latin-(\d+)-normal\.woff2$/.exec(file);
    if (match && pkg.weights.includes(Number(match[1]))) {
      cpSync(`${dir}/${file}`, `public/assets/fonts/${file}`);
    }
  }
}

console.log('client build complete');
