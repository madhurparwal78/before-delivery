// Writes THIRD_PARTY_NOTICES.md from the production dependency tree, the bundled fonts
// and the icon set. Run with `npm run notices` after changing dependencies.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BUNDLED_ASSETS = [
  ['Fraunces (variable), bundled from @fontsource-variable/fraunces', 'SIL OFL 1.1'],
  ['IBM Plex Sans, bundled from @fontsource/ibm-plex-sans', 'SIL OFL 1.1'],
  ['IBM Plex Mono, bundled from @fontsource/ibm-plex-mono', 'SIL OFL 1.1'],
  ['Lucide icon set, bundled from lucide-react', 'ISC'],
];

function licenceOf(name) {
  const manifest = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type).join(', ');
  return manifest.license?.type ?? 'unknown';
}

function collect(node, found) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined) continue;
    const key = `${name}@${entry.version}`;
    if (!found.has(key)) found.set(key, { name, version: entry.version, licence: licenceOf(name) });
    collect(entry, found);
  }
  return found;
}

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }));
const packages = [...collect(tree, new Map()).values()].sort((left, right) => left.name.localeCompare(right.name));

const lines = [
  '# Third-party notices',
  '',
  'Quirewell Stand Desk ships the packages, fonts and icons below.',
  '',
  '## Packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...packages.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  '',
  '## Fonts and icons',
  '',
  '| Asset | Licence |',
  '| --- | --- |',
  ...BUNDLED_ASSETS.map(([asset, licence]) => `| ${asset} | ${licence} |`),
  '',
];

writeFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), `${lines.join('\n')}`);
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md for ${packages.length} packages\n`);
