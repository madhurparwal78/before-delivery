/** Regenerates THIRD_PARTY_NOTICES.md from the production tree and the bundled fonts. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'OFL-1.1',
]);

const FONTS = [
  { name: 'Archivo Black', package: '@fontsource/archivo-black', licence: 'OFL-1.1' },
  { name: 'IBM Plex Sans', package: '@fontsource/ibm-plex-sans', licence: 'OFL-1.1' },
  { name: 'IBM Plex Mono', package: '@fontsource/ibm-plex-mono', licence: 'OFL-1.1' },
];

const listed = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const packages = new Map();

function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version !== undefined) packages.set(`${name}@${entry.version}`, { name, version: entry.version });
    walk(entry);
  }
}
walk(listed);

async function licenceOf(name) {
  const manifest = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (typeof manifest.license?.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) return manifest.licenses[0].type;
  return 'UNKNOWN';
}

const rows = [];
for (const entry of [...packages.values()].sort((left, right) => left.name.localeCompare(right.name))) {
  rows.push({ ...entry, licence: await licenceOf(entry.name) });
}

const fontRows = [];
for (const font of FONTS) {
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules', font.package, 'package.json'), 'utf8'),
  );
  fontRows.push({ ...font, version: manifest.version });
}

const offenders = [...rows, ...fontRows].filter((entry) => !ALLOWED.has(entry.licence));
if (offenders.length > 0) {
  console.error('Disallowed licences:', offenders);
  process.exit(1);
}

const lines = [
  '# Third-party notices',
  '',
  'Common Shed Co. Shedline ships the packages and fonts listed below.',
  '',
  '## Shipped packages',
  '',
  'The production dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  '',
  '## Bundled fonts',
  '',
  'Each font is served by the app itself from `/fonts`.',
  '',
  '| Font | Version | Licence |',
  '| --- | --- | --- |',
  ...fontRows.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  '',
];

await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`);
console.log(`wrote ${rows.length} packages and ${fontRows.length} fonts`);
