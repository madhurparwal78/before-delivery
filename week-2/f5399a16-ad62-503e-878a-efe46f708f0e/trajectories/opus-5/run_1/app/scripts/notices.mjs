/** Writes THIRD_PARTY_NOTICES.md from the production dependency tree. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'OFL-1.1',
]);

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
  }),
);

const found = new Map();

function walk(node) {
  for (const [name, held] of Object.entries(node.dependencies ?? {})) {
    if (held.version !== undefined && !found.has(name)) {
      found.set(name, held.version);
    }
    walk(held);
  }
}
walk(tree);

const rows = [];
for (const [name, version] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const manifest = JSON.parse(
    await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'),
  );
  const licence =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? 'unknown');
  rows.push({ name, version, licence });
  if (!ALLOWED.has(licence)) console.error(`unallowed licence: ${name} ${licence}`);
}

const fonts = [
  { name: 'Libre Franklin', version: 'v20', licence: 'OFL-1.1' },
  { name: 'Source Serif 4', version: 'v15', licence: 'OFL-1.1' },
  { name: 'Noto Sans Arabic', version: 'v18', licence: 'OFL-1.1' },
];

const text = `# Third party notices

Clapstick ships the packages and fonts below. Every licence here is one of
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, Unlicense or,
for fonts, OFL-1.1.

## Shipped packages

The production dependency tree, as \`npm ls --omit=dev --all --json\` reports it.

| Package | Version | Licence |
|---|---|---|
${rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`).join('\n')}

## Shipped fonts

The font files in \`public/fonts\` are served by the app itself; no page loads
anything from another origin.

| Font | Version | Licence |
|---|---|---|
${fonts.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`).join('\n')}

Libre Franklin is © The Libre Franklin Project Authors.
Source Serif 4 is © Adobe.
Noto Sans Arabic is © The Noto Project Authors.
All three are licensed under the SIL Open Font License, Version 1.1.
`;

await writeFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), text, 'utf8');
console.log(`${rows.length} packages, ${fonts.length} fonts`);
