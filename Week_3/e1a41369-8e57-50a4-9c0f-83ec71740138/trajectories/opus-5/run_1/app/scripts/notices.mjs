import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FONTS = [
  {
    name: 'Hubot Sans',
    version: '1.000 (variable, latin and latin-ext subsets)',
    licence: 'OFL-1.1',
    files: 'public/fonts/hubot-sans-latin-standard-normal.woff2, public/fonts/hubot-sans-latin-ext-standard-normal.woff2',
    notice: 'public/fonts/hubot-sans-OFL.txt',
  },
  {
    name: 'Mona Sans',
    version: '1.000 (variable, latin and latin-ext subsets)',
    licence: 'OFL-1.1',
    files: 'public/fonts/mona-sans-latin-standard-normal.woff2, public/fonts/mona-sans-latin-ext-standard-normal.woff2',
    notice: 'public/fonts/mona-sans-OFL.txt',
  },
];

function collect(node, into) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version) into.set(`${name}@${entry.version}`, { name, version: entry.version });
    collect(entry, into);
  }
}

const listed = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' });
const packages = new Map();
collect(JSON.parse(listed), packages);

const rows = [];
for (const { name, version } of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const manifest = JSON.parse(await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
  const licence = manifest.license ?? (manifest.licenses ?? []).map((entry) => entry.type).join(' OR ') ?? 'UNKNOWN';
  rows.push(`| ${name} | ${version} | ${licence} |`);
}

const text = `# Third-party notices

Deedfall ships the packages and typefaces below. Nothing else is bundled, and the
app loads no external resource at runtime.

## Shipped packages

The production dependency tree, from \`npm ls --omit=dev --all --json\`.

| Package | Version | Licence |
|---|---|---|
${rows.join('\n')}

## Bundled typefaces

| Typeface | Version | Licence | Files |
|---|---|---|---|
${FONTS.map((font) => `| ${font.name} | ${font.version} | ${font.licence} | ${font.files} |`).join('\n')}

The full SIL Open Font License 1.1 text for each typeface is kept beside the font
files, at ${FONTS.map((font) => font.notice).join(' and ')}.

Hubot Sans and Mona Sans are by GitHub, Inc. and are used under the SIL Open Font
License 1.1 with the reserved font names "Hubot" and "Mona".
`;

await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), text);
process.stdout.write(`listed ${rows.length} shipped packages and ${FONTS.length} typefaces\n`);
