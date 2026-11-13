import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

rmSync(dist, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

execFileSync('node', [tsc, '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
execFileSync('node', [tsc, '--noEmit', '-p', 'tsconfig.client.json'], { cwd: root, stdio: 'inherit' });

await build({
  entryPoints: [join(root, 'src', 'client', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: true,
  outfile: join(publicDir, 'app.js'),
  logLevel: 'warning',
});

/** The typefaces ship with the desk, so the browser never fetches them from another site. */
const fontFaces = [
  { pkg: '@fontsource/space-grotesk', file: 'space-grotesk', family: 'Space Grotesk', weights: ['500', '700'] },
  { pkg: '@fontsource/ibm-plex-sans', file: 'ibm-plex-sans', family: 'IBM Plex Sans', weights: ['400', '600'] },
  { pkg: '@fontsource/ibm-plex-mono', file: 'ibm-plex-mono', family: 'IBM Plex Mono', weights: ['400', '600'] },
];

/** Polish diacritics live in latin-ext, so both subsets ship. */
const subsets = [
  { name: 'latin', range: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2212,U+FEFF,U+FFFD' },
  { name: 'latin-ext', range: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2C60-2C7F,U+A720-A7FF' },
];

mkdirSync(join(publicDir, 'fonts'), { recursive: true });
let fontCss = '';
for (const font of fontFaces) {
  for (const weight of font.weights) {
    for (const subset of subsets) {
      const name = `${font.file}-${subset.name}-${weight}-normal.woff2`;
      cpSync(join(root, 'node_modules', font.pkg, 'files', name), join(publicDir, 'fonts', name));
      fontCss +=
        `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${weight};` +
        `font-display:swap;src:url("/fonts/${name}") format("woff2");unicode-range:${subset.range}}\n`;
    }
  }
}

const styles = readFileSync(join(root, 'src', 'assets', 'styles.css'), 'utf8');
writeFileSync(join(publicDir, 'styles.css'), `${fontCss}\n${styles}`);
cpSync(join(root, 'src', 'db', 'schema.sql'), join(dist, 'db', 'schema.sql'));

console.log('build complete');
