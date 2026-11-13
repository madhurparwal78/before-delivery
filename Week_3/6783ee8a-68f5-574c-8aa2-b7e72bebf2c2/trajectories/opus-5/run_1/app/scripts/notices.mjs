import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'OFL-1.1',
]);

const FONTS = [
  { name: 'Inter', files: 'fonts/inter.woff2, fonts/inter-italic.woff2', licence: 'OFL-1.1' },
  { name: 'Source Sans 3', files: 'fonts/source-sans-3.woff2', licence: 'OFL-1.1' },
  { name: 'Fira Code', files: 'fonts/fira-code.woff2', licence: 'OFL-1.1' },
];

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, maxBuffer: 1e8 }).toString(),
);

const shipped = new Map();
const walk = (node) => {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version) shipped.set(name, entry);
    walk(entry);
  }
};
walk(tree);

const rows = [...shipped.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, entry]) => {
    const manifest = JSON.parse(
      readFileSync(join(entry.path ?? join(root, 'node_modules', name), 'package.json'), 'utf8'),
    );
    const licence = typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN';
    if (!ALLOWED.has(licence)) throw new Error(`${name}@${entry.version} uses ${licence}`);
    return { name, version: entry.version, licence };
  });

const lines = [
  '# Third party notices',
  '',
  'Brackenpad from Wrenmoor Software ships the packages and fonts listed here.',
  'Every licence below is one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,',
  '0BSD, CC0-1.0 or OFL-1.1.',
  '',
  '## Packages',
  '',
  'The production dependency tree, from `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Files | Licence |',
  '| --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.files} | ${font.licence} |`),
  '',
];

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`);
process.stdout.write(`Listed ${rows.length} packages and ${FONTS.length} fonts\n`);
