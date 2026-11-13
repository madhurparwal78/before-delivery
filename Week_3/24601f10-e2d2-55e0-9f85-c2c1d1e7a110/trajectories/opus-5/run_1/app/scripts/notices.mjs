import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }),
);

const packages = new Map();
const walk = (node) => {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.extraneous === true || entry.missing === true || entry.version === undefined) continue;
    if (!packages.has(name)) {
      const manifestPath = join(root, 'node_modules', name, 'package.json');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
      packages.set(name, { version: entry.version ?? manifest.version ?? '', license: manifest.license ?? 'UNKNOWN' });
    }
    walk(entry);
  }
};
walk(tree);

const rows = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b));
const lines = [
  '# Third party notices',
  '',
  'Cupfold ships the packages below (the production dependency tree from',
  '`npm ls --omit=dev --all --json`) and one bundled font family.',
  '',
  '## Packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map(([name, info]) => `| ${name} | ${info.version} | ${info.license} |`),
  '',
  '## Fonts',
  '',
  '| Font | Files | Licence |',
  '| --- | --- | --- |',
  '| Geist and Geist Mono (Vercel, in collaboration with basement.studio) | `assets/fonts/Geist-Variable.woff2`, `assets/fonts/GeistMono-Variable.woff2` | OFL-1.1 (`assets/fonts/GEIST-OFL-LICENSE.txt`) |',
  '',
];

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`);
process.stdout.write(`${rows.length} packages listed\n`);
