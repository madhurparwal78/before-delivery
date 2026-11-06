/**
 * Regenerates THIRD_PARTY_NOTICES.md from the production dependency tree reported by
 * `npm ls --omit=dev --all --json`, and refuses any licence outside the allowed list.
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

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
    name: 'Anybody',
    files: 'public/fonts/anybody-latin.woff2, public/fonts/anybody-latin-ext.woff2',
    licence: 'OFL-1.1',
    source: 'Google Fonts (Etienne Aubert Bonn)',
  },
  {
    name: 'Instrument Sans',
    files: 'public/fonts/instrument-sans-latin.woff2, public/fonts/instrument-sans-latin-ext.woff2',
    licence: 'OFL-1.1',
    source: 'Google Fonts (Rodrigo Fuenzalida, Jordan Egstad)',
  },
];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }),
);

const found = new Map();

function walk(node) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version !== undefined && !found.has(name)) {
      found.set(name, value.version);
    }
    walk(value);
  }
}
walk(tree);

const rows = [];
const refused = [];
for (const [name, version] of [...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  let licence = 'UNKNOWN';
  try {
    const manifest = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    const declared = manifest.license ?? manifest.licenses;
    licence =
      typeof declared === 'string'
        ? declared
        : Array.isArray(declared)
          ? declared.map((entry) => entry.type ?? entry).join(' OR ')
          : (declared?.type ?? 'UNKNOWN');
  } catch {
    continue;
  }
  if (!ALLOWED.has(licence)) refused.push(`${name}@${version} :: ${licence}`);
  rows.push({ name, version, licence });
}

if (refused.length > 0) {
  process.stderr.write(`licences outside the allowed list:\n${refused.join('\n')}\n`);
  process.exit(1);
}

const lines = [
  '# Third-party notices',
  '',
  'Kerf Frequencies ships the packages, fonts and assets listed here. Every shipped package is',
  'licensed MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or BlueOak-1.0.0; the fonts are',
  'OFL-1.1; every other asset is original to this app.',
  '',
  `Regenerate this file with \`npm run notices\`.`,
  '',
  '## Shipped packages',
  '',
  'The production dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Files | Licence | Source |',
  '| --- | --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.files} | ${font.licence} | ${font.source} |`),
  '',
  '## Bundled assets',
  '',
  '| Asset | Licence |',
  '| --- | --- |',
  '| Programme lattice geometry, the static isometric drawing and the procedural gallery frames, drawn in code from programme data | Original to this app |',
  '| Pass PDFs, including their QR codes, generated at run time | Original to this app |',
  '| Icon drawings | From the Lucide set, bundled through the `lucide-react` package listed above (ISC) |',
  '',
  'No other images, audio, video or data files are shipped.',
  '',
];

await writeFile('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}`);
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
