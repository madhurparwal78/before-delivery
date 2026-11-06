import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'OFL-1.1'];

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }));

const shipped = new Map();
function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (shipped.has(name) || !info.version) continue;
    shipped.set(name, info.version);
    walk(info);
  }
}
walk(tree);

function licenceOf(name) {
  const manifest = join('node_modules', name, 'package.json');
  if (!existsSync(manifest)) return null;
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed.license === 'string') return parsed.license;
  if (parsed.license?.type) return parsed.license.type;
  if (Array.isArray(parsed.licenses)) return parsed.licenses.map((entry) => entry.type).join(' OR ');
  return null;
}

const rows = [...shipped.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, version]) => ({ name, version, licence: licenceOf(name) }));

const refused = rows.filter((row) => !ALLOWED.includes(row.licence));
if (refused.length > 0) {
  console.error('Packages outside the allowed licences:', refused);
  process.exit(1);
}

const lines = [
  '# Third party notices',
  '',
  'Rostara ships the production dependency tree below, as reported by',
  '`npm ls --omit=dev --all --json`. Every package is used under its own licence.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| \`${row.name}\` | ${row.version} | ${row.licence} |`),
  '',
  `Shipped packages: ${rows.length}. Licences in use: ${[...new Set(rows.map((row) => row.licence))].sort().join(', ')}.`,
  '',
];

writeFileSync('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}`);
console.log(`wrote THIRD_PARTY_NOTICES.md for ${rows.length} packages`);
