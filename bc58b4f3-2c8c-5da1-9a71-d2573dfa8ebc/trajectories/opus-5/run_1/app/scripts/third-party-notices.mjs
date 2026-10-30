#!/usr/bin/env node
// Regenerates THIRD_PARTY_NOTICES.md from the production dependency tree.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const FONTS = [
  {
    name: 'Archivo',
    version: '2.001 (woff2 subset from @fontsource/archivo 5.3.0)',
    licence: 'SIL OFL 1.1',
    holder: 'Copyright 2020 The Archivo Project Authors (https://github.com/Omnibus-Type/Archivo)',
  },
  {
    name: 'Atkinson Hyperlegible',
    version: '1.000 (woff2 subset from @fontsource/atkinson-hyperlegible 5.3.0)',
    licence: 'SIL OFL 1.1',
    holder: 'Copyright 2020 Braille Institute of America, Inc.',
  },
];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }),
);

const packages = new Map();

function walk(dependencies) {
  for (const [name, node] of Object.entries(dependencies ?? {})) {
    if (node.version === undefined) continue;
    if (!packages.has(name)) {
      const manifest = JSON.parse(
        readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'),
      );
      packages.set(name, {
        version: node.version,
        licence: manifest.license ?? manifest.licenses?.[0]?.type ?? 'see package',
        homepage: manifest.homepage ?? `https://www.npmjs.com/package/${name}`,
      });
    }
    walk(node.dependencies);
  }
}

walk(tree.dependencies);

const rows = [...packages.entries()].sort(([left], [right]) => (left < right ? -1 : 1));

const lines = [
  '# Third-party notices',
  '',
  'Teamseat ships the packages and fonts below. Each is used under the licence named.',
  '',
  '## Shipped npm packages',
  '',
  'The production dependency tree, as reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map(([name, info]) => `| [${name}](${info.homepage}) | ${info.version} | ${info.licence} |`),
  '',
  '## Bundled fonts',
  '',
  'Both families are served from the application origin, from `dist/client/fonts`.',
  '',
  '| Font | Version | Licence | Copyright |',
  '| --- | --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.version} | ${font.licence} | ${font.holder} |`),
  '',
  '## Licence texts',
  '',
  'MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD licence texts ship inside each',
  'package directory under `node_modules`. The SIL Open Font License 1.1 covers both fonts and',
  'is published at <https://openfontlicense.org>.',
  '',
];

writeFileSync(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), lines.join('\n'));
process.stdout.write(`Wrote ${rows.length} packages and ${FONTS.length} fonts\n`);
