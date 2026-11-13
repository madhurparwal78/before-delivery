// Writes THIRD_PARTY_NOTICES.md from the production dependency tree.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }),
);

const packages = new Map();
function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    const manifestPath = join('node_modules', name, 'package.json');
    if (!packages.has(name) && existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      packages.set(name, { version: child.version, license: manifest.license ?? 'UNKNOWN' });
    }
    walk(child);
  }
}
walk(tree);

const rows = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b));
const bad = rows.filter(([, info]) => !ALLOWED.includes(info.license));
if (bad.length > 0) {
  throw new Error(`packages outside the allowed licences: ${bad.map(([name]) => name).join(', ')}`);
}

const lines = [
  '# Third party notices',
  '',
  'Overlap ships the packages below. Each is used unchanged, under its own licence.',
  '',
  '## npm packages (production dependency tree)',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map(([name, info]) => `| ${name} | ${info.version} | ${info.license} |`),
  '',
  '## Fonts',
  '',
  '| File | Family | Licence |',
  '| --- | --- | --- |',
  '| public/fonts/albert-sans-latin.woff2 | Albert Sans | OFL-1.1 |',
  '| public/fonts/albert-sans-latin-ext.woff2 | Albert Sans | OFL-1.1 |',
  '',
  'Albert Sans is Copyright 2021 The Albert Sans Project Authors',
  '(https://github.com/usted/Albert-Sans), licensed under the SIL Open Font License,',
  'Version 1.1. The full licence text ships with the fonts at',
  '`public/fonts/OFL.txt` and is served at `/fonts/OFL.txt`.',
  '',
];
writeFileSync('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}`);
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
