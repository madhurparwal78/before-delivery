import * as fs from 'node:fs';
import * as path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.join(__dirname, '..', '..');
const publicDir = path.join(root, 'dist', 'public');
const fontsDir = path.join(publicDir, 'fonts');

function copyFont(packageName: string, file: string, target: string): void {
  const source = path.join(root, 'node_modules', packageName, 'files', file);
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(fontsDir, target));
}

async function main(): Promise<void> {
  fs.mkdirSync(fontsDir, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(root, 'client', 'main.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['chrome120', 'firefox120', 'safari17'],
    outfile: path.join(publicDir, 'app.js'),
    logLevel: 'warning',
  });
  copyFont('@fontsource/space-grotesk', 'space-grotesk-latin-600-normal.woff2', 'space-grotesk-600.woff2');
  copyFont('@fontsource/space-grotesk', 'space-grotesk-latin-500-normal.woff2', 'space-grotesk-500.woff2');
  copyFont('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-400-normal.woff2', 'plex-sans-400.woff2');
  copyFont('@fontsource/ibm-plex-sans', 'ibm-plex-sans-latin-500-normal.woff2', 'plex-sans-500.woff2');
  copyFont('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2', 'jetbrains-mono-400.woff2');
  fs.copyFileSync(path.join(root, 'assets', 'app.css'), path.join(publicDir, 'app.css'));
}

void main();
