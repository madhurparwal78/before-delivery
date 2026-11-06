import { copyFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

execSync('npx tsc -p tsconfig.json', { stdio: 'inherit' });

const fontsOut = 'dist/client/fonts';
mkdirSync(fontsOut, { recursive: true });
const packages = [
  ['@fontsource/space-grotesk', 'space-grotesk'],
  ['@fontsource/ibm-plex-sans', 'ibm-plex-sans'],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono'],
];
for (const [pkg, family] of packages) {
  void family;
  const files = join('node_modules', pkg, 'files');
  if (!existsSync(files)) throw new Error(`missing font files for ${pkg}`);
  const variants = readdirSync(files).filter(file => file.endsWith('.woff2') && file.includes('latin'));
  for (const variant of variants) {
    copyFileSync(join(files, variant), join(fontsOut, variant));
  }
}
copyFileSync('src/client/styles.css', 'dist/client/styles.css');
console.log('build complete');

