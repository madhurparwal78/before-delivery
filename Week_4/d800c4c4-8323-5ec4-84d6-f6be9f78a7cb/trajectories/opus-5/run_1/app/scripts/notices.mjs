/**
 * Writes THIRD_PARTY_NOTICES.md from the production dependency tree that
 * `npm ls --omit=dev --all --json` reports, plus the bundled font files.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const FONTS = [
  ['Archivo Black', 'archivo-black-latin-400-normal.woff2', '@fontsource/archivo-black'],
  ['IBM Plex Sans', 'ibm-plex-sans-latin-400-normal.woff2', '@fontsource/ibm-plex-sans'],
  ['IBM Plex Sans', 'ibm-plex-sans-latin-600-normal.woff2', '@fontsource/ibm-plex-sans'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-400-normal.woff2', '@fontsource/ibm-plex-mono'],
  ['IBM Plex Mono', 'ibm-plex-mono-latin-600-normal.woff2', '@fontsource/ibm-plex-mono'],
];

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
]);

function tree() {
  const output = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(output);
}

function licenceOf(name) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry.type).join(' OR ');
  }
  return 'UNKNOWN';
}

function collect(node, found) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (child.resolved === undefined && child.version === undefined) continue;
    const key = `${name}@${child.version}`;
    if (!found.has(key)) {
      found.set(key, { name, version: child.version, licence: licenceOf(name) });
      collect(child, found);
    }
  }
}

const found = new Map();
collect(tree(), found);
const packages = [...found.values()].sort((left, right) => left.name.localeCompare(right.name));

const wrong = packages.filter((entry) => !ALLOWED.has(entry.licence));
if (wrong.length > 0) {
  throw new Error(
    `These shipped packages carry a licence outside the allowed set: ${wrong
      .map((entry) => `${entry.name} (${entry.licence})`)
      .join(', ')}`,
  );
}

const lines = [
  '# Third-party notices',
  '',
  'Pegworth Desk ships the packages and font files listed here. Nothing else is',
  'served to the browser, and the browser loads nothing from another origin.',
  '',
  '## Shipped packages',
  '',
  'Every package in the production dependency tree reported by',
  '`npm ls --omit=dev --all --json`:',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...packages.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  '',
  '## Bundled fonts',
  '',
  'Self-hosted from the font files shipped in `dist/public/assets/fonts`.',
  '',
  '| Font | File | Source package | Licence |',
  '| --- | --- | --- | --- |',
  ...FONTS.map(([family, file, pkg]) => `| ${family} | ${file} | ${pkg} | OFL-1.1 |`),
  '',
  '## Icons',
  '',
  'The line icons and tool silhouettes are drawn in this repository as SVG paths',
  'from each part’s shape kind and its size in holes. No icon package is shipped.',
  '',
];

writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`, 'utf8');
process.stdout.write(`THIRD_PARTY_NOTICES.md lists ${packages.length} packages\n`);
