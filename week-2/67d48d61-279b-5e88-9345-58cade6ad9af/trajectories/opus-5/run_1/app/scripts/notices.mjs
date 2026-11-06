// Writes THIRD_PARTY_NOTICES.md from the production dependency tree.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { encoding: 'utf8' }));
const packages = new Map();

function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined) continue;
    const key = `${name}@${entry.version}`;
    if (!packages.has(key)) {
      packages.set(key, { name, version: entry.version });
      walk(entry);
    }
  }
}
walk(tree);

function licenceOf(name) {
  const manifest = `node_modules/${name}/package.json`;
  if (!existsSync(manifest)) return 'UNKNOWN';
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed.license === 'string') return parsed.license;
  if (parsed.license?.type !== undefined) return parsed.license.type;
  if (Array.isArray(parsed.licenses)) return parsed.licenses.map((entry) => entry.type).join(' / ');
  return 'UNKNOWN';
}

const rows = [...packages.values()]
  .map((entry) => ({ ...entry, licence: licenceOf(entry.name) }))
  .sort((a, b) => a.name.localeCompare(b.name));

const fonts = [
  { name: 'Fraunces', version: '@fontsource/fraunces 5.3.0', licence: 'SIL OFL-1.1' },
  { name: 'IBM Plex Sans', version: '@fontsource/ibm-plex-sans 5.3.0', licence: 'SIL OFL-1.1' },
  { name: 'IBM Plex Mono', version: '@fontsource/ibm-plex-mono 5.3.0', licence: 'SIL OFL-1.1' },
];

const lines = [
  '# Third party notices',
  '',
  'Promptside ships the packages and fonts below.',
  '',
  '## Shipped packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Package | Licence |',
  '| --- | --- | --- |',
  ...fonts.map((font) => `| ${font.name} | ${font.version} | ${font.licence} |`),
  '',
];

writeFileSync('THIRD_PARTY_NOTICES.md', lines.join('\n'));
console.log(`Wrote ${rows.length} packages and ${fonts.length} fonts.`);
