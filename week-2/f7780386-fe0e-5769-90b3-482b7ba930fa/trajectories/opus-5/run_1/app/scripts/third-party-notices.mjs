#!/usr/bin/env node
/**
 * Regenerates THIRD_PARTY_NOTICES.md from the production dependency tree
 * reported by `npm ls --omit=dev --all --json`, plus the bundled fonts.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
]);

const FONTS = [
  {
    name: 'Big Shoulders Display',
    version: 'v21 (Google Fonts, latin subset)',
    license: 'OFL-1.1',
    file: 'public/fonts/OFL-big-shoulders-display.txt',
  },
  {
    name: 'Public Sans',
    version: 'v15 (Google Fonts, latin subset)',
    license: 'OFL-1.1',
    file: 'public/fonts/OFL-public-sans.txt',
  },
];

function licenseOf(name) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  const declared = manifest.license ?? manifest.licenses;
  if (typeof declared === 'string') return declared;
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map((entry) => entry.type ?? entry).join(' OR ');
  }
  throw new Error(`${name} declares no licence`);
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 64,
  }).toString(),
);

const packages = new Map();
(function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (typeof child.version === 'string') packages.set(name, child.version);
    walk(child);
  }
})(tree);

const rows = [...packages.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, version]) => ({ name, version, license: licenseOf(name) }));

const disallowed = rows.filter((row) => !ALLOWED.has(row.license));
if (disallowed.length > 0) {
  console.error('Disallowed licences:', disallowed);
  process.exit(1);
}

const lines = [
  '# Third-party notices',
  '',
  'Passboard ships the packages and fonts listed here. Every shipped package is',
  'licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or',
  'BlueOak-1.0.0; every bundled font is licensed OFL-1.1.',
  '',
  '## Fonts',
  '',
  '| Font | Version | Licence | Licence text |',
  '| --- | --- | --- | --- |',
  ...FONTS.map(
    (font) => `| ${font.name} | ${font.version} | ${font.license} | \`${font.file}\` |`,
  ),
  '',
  'Both faces are self-hosted under `public/fonts/`; the browser makes no',
  'requests to third-party hosts.',
  '',
  `## Packages (${rows.length})`,
  '',
  'The production dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`),
  '',
];

writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`Wrote THIRD_PARTY_NOTICES.md: ${rows.length} packages, ${FONTS.length} fonts.`);
