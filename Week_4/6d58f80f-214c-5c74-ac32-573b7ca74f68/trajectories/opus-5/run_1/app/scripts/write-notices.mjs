import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
);

const packages = new Map();

const walk = (node) => {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version === undefined) continue;
    packages.set(`${name}@${value.version}`, { name, version: value.version });
    walk(value);
  }
};
walk(tree);

const licenceOf = ({ name }) => {
  const manifest = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) return 'UNKNOWN';
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed.license === 'string') return parsed.license;
  if (typeof parsed.license === 'object' && parsed.license !== null) {
    return parsed.license.type ?? 'UNKNOWN';
  }
  if (Array.isArray(parsed.licenses)) {
    return parsed.licenses.map((entry) => entry.type ?? 'UNKNOWN').join(' OR ');
  }
  return 'UNKNOWN';
};

const rows = [...packages.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((entry) => ({ ...entry, licence: licenceOf(entry) }));

const allowed = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);

const offenders = rows.filter((row) => !allowed.has(row.licence));
if (offenders.length > 0) {
  console.error('Packages with a licence outside the allowed set:', offenders);
  process.exit(1);
}

const lines = [
  '# Third-party notices',
  '',
  'Lintel Drive ships the packages and assets below. Every one is under MIT, ISC,',
  'BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.',
  '',
  '## Production dependency tree',
  '',
  'Taken from `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Bundled assets',
  '',
  '| Asset | Version | Licence |',
  '| --- | --- | --- |',
  '| IBM Plex Sans (via @fontsource/ibm-plex-sans) | 5.2.6 | OFL-1.1 |',
  '| IBM Plex Sans Condensed (via @fontsource/ibm-plex-sans-condensed) | 5.2.5 | OFL-1.1 |',
  '| IBM Plex Mono (via @fontsource/ibm-plex-mono) | 5.2.5 | OFL-1.1 |',
  '| Lucide icons (via lucide-react) | 0.468.0 | ISC |',
  '',
];

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`);
console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages`);
