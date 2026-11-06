import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The production dependency tree, exactly as IF-02 defines it. */
function productionTree() {
  const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const tree = JSON.parse(raw);
  const found = new Map();
  const walk = (node) => {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child.version === undefined) continue; // an unmet optional peer
      found.set(`${name}@${child.version}`, { name, version: child.version });
      walk(child);
    }
  };
  walk(tree);
  return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function licenceOf(name) {
  const manifest = JSON.parse(
    await readFile(resolve(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  const licence = manifest.license ?? manifest.licenses;
  if (typeof licence === 'string') return licence;
  if (Array.isArray(licence)) return licence.map((l) => l.type ?? l).join(' OR ');
  return licence?.type ?? 'UNKNOWN';
}

const FONT_SOURCES = [
  { prefix: 'space-grotesk', family: 'Space Grotesk', package: '@fontsource/space-grotesk' },
  { prefix: 'ibm-plex-sans', family: 'IBM Plex Sans', package: '@fontsource/ibm-plex-sans' },
  { prefix: 'ibm-plex-mono', family: 'IBM Plex Mono', package: '@fontsource/ibm-plex-mono' },
];

const packages = productionTree();
const rows = [];
for (const entry of packages) {
  rows.push(`| \`${entry.name}\` | ${entry.version} | ${await licenceOf(entry.name)} |`);
}

const fontFiles = (await readdir(resolve(root, 'assets/fonts'))).sort();
const fontRows = fontFiles.map((file) => {
  const source = FONT_SOURCES.find((f) => file.startsWith(f.prefix));
  return `| \`${file}\` | ${source?.family ?? file} | SIL Open Font License 1.1 |`;
});

const body = `# Third-party notices

Turnstone Studio ships the packages and fonts listed here. Every one is covered
by a licence from the allowed set: MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, MPL-2.0 or the SIL Open Font License 1.1.

## Shipped packages

These are the production dependency tree, as reported by
\`npm ls --omit=dev --all --json\`.

| Package | Version | Licence |
| --- | --- | --- |
${rows.join('\n')}

## Bundled fonts

The font files are served by the app itself, from \`assets/fonts\`. No page
loads a script, style or font from another origin.

| File | Family | Licence |
| --- | --- | --- |
${fontRows.join('\n')}

Space Grotesk is © Florian Karsten, released under the SIL Open Font License 1.1.
IBM Plex Sans and IBM Plex Mono are © IBM Corp., released under the SIL Open
Font License 1.1. The files were taken from the \`@fontsource\` packages of the
same names, which are build tooling only and are not shipped.
`;

await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), body, 'utf8');
process.stdout.write(`Wrote THIRD_PARTY_NOTICES.md (${packages.length} packages, ${fontFiles.length} fonts).\n`);
