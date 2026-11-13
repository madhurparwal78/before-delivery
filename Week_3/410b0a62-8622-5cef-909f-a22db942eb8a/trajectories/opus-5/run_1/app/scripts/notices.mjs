import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const FONTS = [
  {
    name: 'Encode Sans Expanded (ExtraBold)',
    source: '@fontsource/encode-sans-expanded',
    licence: 'OFL-1.1',
    copyright: 'Copyright 2017 The Encode Sans Project Authors (https://github.com/twardoch/EncodeSans)',
  },
  {
    name: 'Inter (Regular, Medium)',
    source: '@fontsource/inter',
    licence: 'OFL-1.1',
    copyright: 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)',
  },
];

function flatten(node, into) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined || entry.missing === true || entry.peerMissing === true) continue;
    const key = `${name}@${entry.version}`;
    if (!into.has(key)) into.set(key, { name, version: entry.version });
    flatten(entry, into);
  }
  return into;
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);
const packages = [...flatten(tree, new Map()).values()].sort((left, right) =>
  left.name.localeCompare(right.name),
);

const rows = [];
for (const entry of packages) {
  const manifest = JSON.parse(
    await readFile(path.join(root, 'node_modules', entry.name, 'package.json'), 'utf8'),
  );
  const licence =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? 'UNKNOWN');
  rows.push({ name: entry.name, version: entry.version, licence });
}

const lines = [
  '# Third-party notices',
  '',
  'Ottermere Sport Tempoline ships the packages and fonts below.',
  '',
  '## Shipped packages',
  '',
  'Every package in the production dependency tree (`npm ls --omit=dev --all --json`).',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Source package | Licence |',
  '| --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.source} | ${font.licence} |`),
  '',
  ...FONTS.map((font) => `- ${font.name}: ${font.copyright}. Licensed under the SIL Open Font License 1.1.`),
  '',
];

await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}\n`);
console.log(`Wrote ${rows.length} packages and ${FONTS.length} fonts.`);
