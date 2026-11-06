import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const fonts = [
  {
    name: 'Archivo (variable, latin and latin-ext)',
    licence: 'OFL-1.1',
    notice: 'Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)',
    source: '@fontsource-variable/archivo',
  },
  {
    name: 'IBM Plex Sans (400 and 600, latin and latin-ext)',
    licence: 'OFL-1.1',
    notice: 'Copyright 2017 IBM Corp. (https://github.com/IBM/plex)',
    source: '@fontsource/ibm-plex-sans',
  },
];

function collect(node, into) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    const version = entry.version ?? '';
    into.set(`${name}@${version}`, { name, version });
    collect(entry, into);
  }
  return into;
}

async function licenceOf(name) {
  const file = path.join(root, 'node_modules', name, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  const licence = manifest.license ?? (manifest.licenses ?? []).map((entry) => entry.type).join(' OR ');
  return typeof licence === 'string' ? licence : JSON.stringify(licence);
}

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root }).toString());
const packages = [...collect(tree, new Map()).values()].sort((left, right) => left.name.localeCompare(right.name));

const rows = [];
for (const entry of packages) {
  rows.push(`| \`${entry.name}\` | ${entry.version} | ${await licenceOf(entry.name)} |`);
}

const text = `# Third-party notices

Tally Split ships the packages and fonts below. Everything else in this repository is the app's own source.

## Shipped packages

The production dependency tree from \`npm ls --omit=dev --all --json\`.

| Package | Version | Licence |
| --- | --- | --- |
${rows.join('\n')}

## Bundled fonts

Both families are served from the app's own origin, from the files in \`dist/public/fonts\`.

| Font | Licence | Notice | Packaged from |
| --- | --- | --- | --- |
${fonts.map((font) => `| ${font.name} | ${font.licence} | ${font.notice} | \`${font.source}\` |`).join('\n')}

The SIL Open Font License 1.1 text is included with each font package in \`node_modules\`.
`;

await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), text);
console.log(`wrote notices for ${rows.length} packages`);
