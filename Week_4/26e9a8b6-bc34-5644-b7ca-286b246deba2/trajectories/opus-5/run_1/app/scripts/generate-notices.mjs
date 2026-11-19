/**
 * Writes THIRD_PARTY_NOTICES.md from the production dependency tree
 * (`npm ls --omit=dev --all --json`) plus the bundled font files.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);

const BUNDLED_FONTS = [
  {
    name: 'Dela Gothic One',
    file: 'public/fonts/dela-gothic-one-latin.woff2',
    licence: 'OFL-1.1',
    holder: 'Nippon Design, Yoshimichi Ohira',
  },
  {
    name: 'DM Sans',
    file: 'public/fonts/dm-sans-latin.woff2',
    licence: 'OFL-1.1',
    holder: 'Colophon Foundry, Jonny Pinhorn, Indian Type Foundry',
  },
];

function collect(node, into) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined) continue;
    const key = `${name}@${entry.version}`;
    if (!into.has(key)) {
      const packageJsonPath = join('node_modules', name, 'package.json');
      const manifest = existsSync(packageJsonPath)
        ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        : {};
      into.set(key, {
        name,
        version: entry.version,
        licence: manifest.license ?? 'UNKNOWN',
        homepage: manifest.homepage ?? `https://www.npmjs.com/package/${name}`,
      });
    }
    collect(entry, into);
  }
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }),
);
const packages = new Map();
collect(tree, packages);

const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const offending = [
  ...rows.filter((row) => !ALLOWED.has(row.licence)),
  ...BUNDLED_FONTS.filter((font) => !ALLOWED.has(font.licence)),
];

const lines = [
  '# Third-party notices',
  '',
  'Pennywasher ships the packages and font files listed here. Everything else',
  'in this repository is first-party source.',
  '',
  '## Shipped packages',
  '',
  'The production dependency tree, as reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence | Home |',
  '| --- | --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} | ${row.homepage} |`),
  '',
  '## Bundled fonts',
  '',
  'Served from this app’s own origin; no remote font is ever requested.',
  '',
  '| Font | File | Licence | Copyright holder |',
  '| --- | --- | --- | --- |',
  ...BUNDLED_FONTS.map((font) => `| ${font.name} | ${font.file} | ${font.licence} | ${font.holder} |`),
  '',
  '## Licence texts',
  '',
  '- MIT: https://opensource.org/license/mit',
  '- ISC: https://opensource.org/license/isc-license-txt',
  '- BSD-2-Clause: https://opensource.org/license/bsd-2-clause',
  '- BSD-3-Clause: https://opensource.org/license/bsd-3-clause',
  '- Apache-2.0: https://www.apache.org/licenses/LICENSE-2.0',
  '- 0BSD: https://opensource.org/license/0bsd',
  '- OFL-1.1: https://openfontlicense.org',
  '',
];

writeFileSync('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}`);

if (offending.length > 0) {
  process.stderr.write(
    `Licences outside the allowed set: ${offending.map((row) => `${row.name ?? row.file} (${row.licence})`).join(', ')}\n`,
  );
  process.exit(1);
}
process.stdout.write(`THIRD_PARTY_NOTICES.md lists ${rows.length} packages and ${BUNDLED_FONTS.length} fonts\n`);
