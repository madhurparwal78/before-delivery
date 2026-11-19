const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'LGPL-3.0-or-later',
]);

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const shipped = new Map();
(function walk(node) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version) shipped.set(name, value.version);
    walk(value);
  }
})(tree);

function licenceOf(name) {
  const manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    return manifest.licenses[0].type;
  }
  throw new Error(`no licence found for ${name}`);
}

const rows = [...shipped.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, version]) => ({ name, version, licence: licenceOf(name) }));

const refused = rows.filter((row) => !ALLOWED.has(row.licence));
if (refused.length > 0) {
  throw new Error(`licences outside the allowed set: ${JSON.stringify(refused)}`);
}

const lines = [
  '# Third party notices',
  '',
  'Nightroll ships the production dependency tree below, as reported by',
  '`npm ls --omit=dev --all --json`. Each package is used under the licence named.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  'No fonts, images, scripts or stylesheets are loaded from another origin, and no font',
  'files are shipped. The application itself is covered by the MIT licence.',
  '',
];

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
