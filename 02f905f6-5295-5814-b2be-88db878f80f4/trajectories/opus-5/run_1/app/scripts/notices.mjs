/**
 * Writes THIRD_PARTY_NOTICES.md from the production dependency tree
 * (`npm ls --omit=dev --all --json`) plus the bundled font families.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const FONTS = [
  {
    family: 'Fraunces',
    version: '@fontsource-variable/fraunces',
    licence: 'OFL-1.1',
    note: 'headings',
  },
  {
    family: 'IBM Plex Sans',
    version: '@fontsource/ibm-plex-sans',
    licence: 'OFL-1.1',
    note: 'body text and labels',
  },
  {
    family: 'IBM Plex Mono',
    version: '@fontsource/ibm-plex-mono',
    licence: 'OFL-1.1',
    note: 'measurements, prices and times',
  },
];

function licenceOf(name) {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
  );
  const licence = manifest.license ?? manifest.licenses;
  if (typeof licence === 'string') return licence;
  if (Array.isArray(licence)) return licence.map((entry) => entry.type ?? entry).join(' OR ');
  return 'see package';
}

function collect(node, into) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (!value.version) continue;
    const key = `${name}@${value.version}`;
    if (!into.has(key)) into.set(key, { name, version: value.version, licence: licenceOf(name) });
    collect(value, into);
  }
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: ROOT, encoding: 'utf8' }),
);
const packages = new Map();
collect(tree, packages);

const fontVersions = FONTS.map((font) => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, 'node_modules', font.version, 'package.json'), 'utf8'),
  );
  return { ...font, packageVersion: `${font.version}@${manifest.version}` };
});

const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));

const lines = [
  '# Third-party notices',
  '',
  'Shelfmark ships the packages and fonts below. Every one is under MIT, ISC,',
  'BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or, for fonts, OFL-1.1.',
  '',
  '## Bundled fonts',
  '',
  '| Family | Package | Licence | Used for |',
  '| --- | --- | --- | --- |',
  ...fontVersions.map(
    (font) => `| ${font.family} | ${font.packageVersion} | ${font.licence} | ${font.note} |`,
  ),
  '',
  `## Production packages (${rows.length})`,
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
];

writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages`);
