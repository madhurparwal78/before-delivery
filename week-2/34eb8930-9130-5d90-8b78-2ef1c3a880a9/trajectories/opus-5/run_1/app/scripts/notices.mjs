import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root }).toString());

const packages = new Map();
const walk = (node) => {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.missing || entry.version === undefined) continue;
    packages.set(name, entry.version);
    walk(entry);
  }
};
walk(tree);

const licenceOf = async (name) => {
  const manifest = JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
  return typeof manifest.license === 'string' ? manifest.license : 'See package';
};

const rows = [];
for (const [name, version] of [...packages].sort()) {
  rows.push(`| ${name} | ${version} | ${await licenceOf(name)} |`);
}

const fontVersion = async (name) =>
  JSON.parse(await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version;

const body = `# Third-party notices

Quillmere Drafts ships the packages, fonts and icons listed here. Each is used under its own licence.

## Shipped packages

These are every package in the production dependency tree (\`npm ls --omit=dev --all\`).

| Package | Version | Licence |
| --- | --- | --- |
${rows.join('\n')}

## Fonts

Both font families are self-hosted as WOFF2 files under \`/fonts\`.

| Font | Source | Licence |
| --- | --- | --- |
| Newsreader | @fontsource/newsreader ${await fontVersion('@fontsource/newsreader')} | OFL-1.1 |
| Source Serif 4 | @fontsource/source-serif-4 ${await fontVersion('@fontsource/source-serif-4')} | OFL-1.1 |

## Icons

| Icon set | Source | Licence |
| --- | --- | --- |
| Lucide | lucide-static ${await fontVersion('lucide-static')} | ISC |
`;

await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), body);
process.stdout.write(`${rows.length} packages written\n`);
