import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
]);

const FONTS = [
  ['Bravura (subset)', '1.392', 'OFL-1.1', 'Steinberg Media Technologies GmbH'],
  ['Fraunces', '2.000', 'OFL-1.1', 'Phaedra Charles and Flavia Zimbardi'],
  ['IBM Plex Sans', '3.000', 'OFL-1.1', 'IBM Corp.'],
  ['IBM Plex Mono', '3.000', 'OFL-1.1', 'IBM Corp.'],
];

function dependencyTree() {
  try {
    return execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' });
  } catch (cause) {
    return cause.stdout;
  }
}

const tree = JSON.parse(dependencyTree());

function licenceOf(name, path) {
  const where = path ?? new URL(`../node_modules/${name}/package.json`, import.meta.url).pathname;
  const file = where.endsWith('package.json') ? where : `${where}/package.json`;
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((item) => item.type).join(' OR ');
  return 'UNKNOWN';
}

const found = new Map();
function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (child.version === undefined) continue;
    const key = `${name}@${child.version}`;
    if (!found.has(key)) {
      found.set(key, { name, version: child.version, licence: licenceOf(name, child.path) });
    }
    walk(child);
  }
}
walk(tree);

const packages = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const offending = packages.filter((item) => !ALLOWED.has(item.licence));
if (offending.length > 0) {
  throw new Error(`Licences outside the allowlist: ${offending.map((i) => `${i.name} (${i.licence})`).join(', ')}`);
}

const lines = [
  '# Third-party notices',
  '',
  'Fairline ships the packages and fonts listed here. Every shipped package is licensed MIT,',
  'ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or CC0-1.0, and every',
  'bundled font is licensed OFL-1.1.',
  '',
  '## Shipped packages',
  '',
  'The production dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...packages.map((item) => `| ${item.name} | ${item.version} | ${item.licence} |`),
  '',
  '## Bundled fonts',
  '',
  'The font files served from `/fonts/` are bundled in this repository under `assets/fonts/`.',
  'Each licence text is kept beside the font files.',
  '',
  '| Font | Version | Licence | Copyright |',
  '| --- | --- | --- | --- |',
  ...FONTS.map(([name, version, licence, holder]) => `| ${name} | ${version} | ${licence} | ${holder} |`),
  '',
  '- Bravura: SIL Open Font License 1.1 — `assets/fonts/Bravura-OFL.txt`.',
  '  Only the glyphs Fairline engraves are kept in the bundled subset.',
  '- Fraunces: SIL Open Font License 1.1 — `assets/fonts/Fraunces-OFL.txt`.',
  '- IBM Plex Sans and IBM Plex Mono: SIL Open Font License 1.1 — `assets/fonts/IBMPlex-OFL.txt`.',
  '',
];

const target = new URL('../THIRD_PARTY_NOTICES.md', import.meta.url);
const next = `${lines.join('\n')}`;
const current = await readFile(target, 'utf8').catch(() => '');
if (current !== next) await writeFile(target, next);
console.log(`${packages.length} shipped packages, ${FONTS.length} fonts`);
