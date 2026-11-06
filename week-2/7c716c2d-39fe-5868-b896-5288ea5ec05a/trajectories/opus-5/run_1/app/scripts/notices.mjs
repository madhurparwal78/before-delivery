// Rebuilds THIRD_PARTY_NOTICES.md from the production dependency tree.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }));
const packages = new Map();

function walk(dependencies) {
  for (const [name, info] of Object.entries(dependencies ?? {})) {
    if (info.version === undefined) continue;
    packages.set(name, info.version);
    walk(info.dependencies);
  }
}
walk(tree.dependencies);

function licenceOf(name) {
  const manifest = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type).join(', ');
  return 'unknown';
}

const rows = [...packages.entries()]
  .sort(([left], [right]) => (left < right ? -1 : 1))
  .map(([name, version]) => `| ${name} | ${version} | ${licenceOf(name)} |`);

const notices = `# Third party notices

Tallyroom ships the packages and assets below. Every one is under MIT, ISC,
0BSD, BSD-2-Clause, BSD-3-Clause, Apache-2.0 or OFL-1.1.

## Production dependency tree

| Package | Version | Licence |
| --- | --- | --- |
${rows.join('\n')}

## Bundled assets

| Asset | Source | Licence |
| --- | --- | --- |
| IBM Plex Sans (Regular, SemiBold) | IBM Plex, \`public/fonts/IBMPlexSans-*.woff2\` | OFL-1.1 |
| IBM Plex Sans Condensed (Regular, SemiBold) | IBM Plex, \`public/fonts/IBMPlexSansCondensed-*.woff2\` | OFL-1.1 |
| IBM Plex Mono (Regular, SemiBold) | IBM Plex, \`public/fonts/IBMPlexMono-*.woff2\` | OFL-1.1 |
| Lucide icons (list-checks, calendar-days, messages-square, file-text, door-open, settings, user-round, log-out) | Lucide, drawn inline in \`src/client/icons.ts\` | ISC |

The IBM Plex licence text ships with the fonts in
\`public/fonts/IBM-Plex-LICENSE.txt\`.

## Build-time tools

These are development dependencies and are not shipped: typescript (Apache-2.0),
esbuild (MIT), @types/node (MIT), @types/pg (MIT).
`;

writeFileSync('THIRD_PARTY_NOTICES.md', notices);
console.log(`wrote ${rows.length} packages`);
