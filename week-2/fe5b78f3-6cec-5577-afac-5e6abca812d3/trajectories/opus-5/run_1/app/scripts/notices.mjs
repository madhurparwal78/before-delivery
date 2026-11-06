import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const FONTS = [
  ['Archivo', 'OFL-1.1', 'https://github.com/Omnibus-Type/Archivo', '@fontsource/archivo'],
  ['IBM Plex Sans', 'OFL-1.1', 'https://github.com/IBM/plex', '@fontsource/ibm-plex-sans'],
  ['JetBrains Mono', 'OFL-1.1', 'https://github.com/JetBrains/JetBrainsMono', '@fontsource/jetbrains-mono'],
];

const ICONS = [['Lucide', 'ISC', 'https://github.com/lucide-icons/lucide', 'lucide-static']];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const packages = new Map();
function walk(dependencies) {
  for (const [name, node] of Object.entries(dependencies ?? {})) {
    if (typeof node.version !== 'string') continue;
    if (!existsSync(join(root, 'node_modules', name, 'package.json'))) continue;
    packages.set(name, node.version);
    walk(node.dependencies);
  }
}
walk(tree.dependencies);

function licenceOf(name) {
  const manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (typeof manifest.license === 'object' && manifest.license !== null) {
    return String(manifest.license.type);
  }
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((l) => l.type).join(' / ');
  return 'UNKNOWN';
}

const rows = [...packages.keys()].sort().map((name) => {
  const manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  const url = typeof manifest.homepage === 'string'
    ? manifest.homepage
    : `https://www.npmjs.com/package/${name}`;
  return `| \`${name}\` | ${packages.get(name)} | ${licenceOf(name)} | ${url} |`;
});

const devVersion = (name) => JSON.parse(
  readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'),
).version;

const body = `# Third-party notices

Pakka Rail ships the production dependency tree below, the three typefaces and the icon set.
Every one of them is under MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or OFL-1.1.

## Shipped packages

The production dependency tree, as reported by \`npm ls --omit=dev --all --json\`.

| Package | Version | Licence | Home |
| --- | --- | --- | --- |
${rows.join('\n')}

## Fonts

The web font files are copied into the build from the \`@fontsource\` packages and served from
the app itself. No font is loaded from a third-party host.

| Font | Licence | Home | Source package |
| --- | --- | --- | --- |
${FONTS.map(([name, licence, url, pkg]) =>
    `| ${name} | ${licence} | ${url} | \`${pkg}\` ${devVersion(pkg)} |`).join('\n')}

## Icons

The icon outlines are inlined into the browser bundle at build time from the icon set below.

| Icon set | Licence | Home | Source package |
| --- | --- | --- | --- |
${ICONS.map(([name, licence, url, pkg]) =>
    `| ${name} | ${licence} | ${url} | \`${pkg}\` ${devVersion(pkg)} |`).join('\n')}
`;

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), body);
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
