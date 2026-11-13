// Writes THIRD_PARTY_NOTICES.md from the production dependency tree and the bundled fonts.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);

const FONTS = [
  ['Saira Condensed', '@fontsource/saira-condensed', 'OFL-1.1', 'Omnibus-Type'],
  ['IBM Plex Sans', '@fontsource/ibm-plex-sans', 'OFL-1.1', 'IBM'],
  ['IBM Plex Mono', '@fontsource/ibm-plex-mono', 'OFL-1.1', 'IBM'],
];

const ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'OFL-1.1'];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: fileURLToPath(root),
    encoding: 'utf8',
  }),
);

const packages = new Map();
function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    packages.set(`${name}@${entry.version}`, { name, version: entry.version });
    walk(entry);
  }
}
walk(tree);

for (const key of packages.keys()) {
  const { name } = packages.get(key);
  const manifest = JSON.parse(
    await readFile(new URL(`node_modules/${name}/package.json`, root), 'utf8'),
  );
  packages.get(key).license = manifest.license ?? 'see package';
  packages.get(key).description = manifest.description ?? '';
}

const rows = [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
const unexpected = rows.filter((row) => !ALLOWED.includes(row.license));
if (unexpected.length > 0) {
  throw new Error(`unexpected licences: ${unexpected.map((row) => `${row.name} ${row.license}`).join(', ')}`);
}

const lines = [
  '# Third party notices',
  '',
  'Ebbstone Marine Slackwater ships the packages and fonts below. Each is used under the licence named.',
  '',
  '## Shipped packages',
  '',
  'Every package in the production dependency tree, from `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.license} |`),
  '',
  '## Bundled fonts',
  '',
  'The font files are served from the app itself, from the packages named.',
  '',
  '| Font | Package | Licence | Copyright |',
  '| --- | --- | --- | --- |',
  ...FONTS.map(([font, pkg, licence, owner]) => `| ${font} | ${pkg} | ${licence} | ${owner} |`),
  '',
  '## Licence texts',
  '',
  'Each package carries its own licence text in `node_modules/<package>/LICENSE`.',
  'The SIL Open Font Licence 1.1 text for the fonts above is in',
  '`node_modules/@fontsource/<font>/LICENSE`.',
  '',
];

await writeFile(new URL('THIRD_PARTY_NOTICES.md', root), lines.join('\n'));
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
