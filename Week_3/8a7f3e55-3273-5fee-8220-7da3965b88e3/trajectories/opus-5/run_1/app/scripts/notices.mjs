// Regenerates THIRD_PARTY_NOTICES.md from the production dependency tree and the bundled fonts.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLED_FONTS = [
  { name: 'Archivo', package: '@fontsource/archivo', licence: 'OFL-1.1' },
  { name: 'IBM Plex Sans', package: '@fontsource/ibm-plex-sans', licence: 'OFL-1.1' },
  { name: 'IBM Plex Mono', package: '@fontsource/ibm-plex-mono', licence: 'OFL-1.1' },
];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }),
);

const packages = new Map();

function manifestOf(name) {
  try {
    return JSON.parse(readFileSync(join('node_modules', name, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    // Optional peers that npm lists but never installed ship nothing.
    if (!packages.has(name) && manifestOf(name) !== null) {
      packages.set(name, child.version ?? 'unknown');
    }
    walk(child);
  }
}

walk(tree);

function licenceOf(name) {
  const manifest = manifestOf(name) ?? {};
  const licence = manifest.license ?? manifest.licenses;
  if (typeof licence === 'string') return licence;
  if (Array.isArray(licence)) return licence.map((entry) => entry.type ?? entry).join(' OR ');
  return 'see package';
}

const rows = [...packages.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([name, version]) => `| \`${name}\` | ${version} | ${licenceOf(name)} |`);

const fontRows = BUNDLED_FONTS.map((font) => {
  const manifest = JSON.parse(
    readFileSync(join('node_modules', font.package, 'package.json'), 'utf8'),
  );
  return `| ${font.name} | \`${font.package}\` ${manifest.version} | ${font.licence} |`;
});

const body = `# Third-party notices

Relayline ships the packages and fonts listed here. Shipped packages are the production
dependency tree reported by \`npm ls --omit=dev --all --json\`; regenerate this file with
\`npm run notices\`.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
${rows.join('\n')}

## Bundled fonts

All three font families are self-hosted from the app's own origin and are licensed under the
SIL Open Font License 1.1.

| Font family | Source package | Licence |
|---|---|---|
${fontRows.join('\n')}
`;

writeFileSync('THIRD_PARTY_NOTICES.md', body);
process.stdout.write(`Wrote ${packages.size} packages and ${BUNDLED_FONTS.length} fonts.\n`);
