import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ALLOWED = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'OFL-1.1'];

const FONTS = [
  { name: 'Barlow Condensed', version: 'v13 (latin subset)', licence: 'OFL-1.1' },
  { name: 'IBM Plex Sans', version: 'v23 (latin subset)', licence: 'OFL-1.1' },
  { name: 'IBM Plex Mono', version: 'v20 (latin subset)', licence: 'OFL-1.1' }
];

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }));

const found = new Map();
function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined) continue;
    if (!found.has(name)) {
      let licence = 'UNKNOWN';
      try {
        const manifest = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
        licence = manifest.license ?? manifest.licenses?.[0]?.type ?? 'UNKNOWN';
      } catch {
        licence = 'UNKNOWN';
      }
      found.set(name, { version: entry.version, licence });
    }
    walk(entry);
  }
}
walk(tree);

const rows = [...found.entries()].sort(([a], [b]) => a.localeCompare(b));
const offenders = rows.filter(([, info]) => !ALLOWED.includes(info.licence));
if (offenders.length > 0) {
  throw new Error(`Packages outside the allowed licences: ${offenders.map(([name]) => name).join(', ')}`);
}

const lines = [
  '# Third-party notices',
  '',
  'Kerfwell Rack ships the packages and fonts listed below. Every entry is covered by one of',
  'MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.',
  '',
  '## npm packages',
  '',
  'The production dependency tree from `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map(([name, info]) => `| ${name} | ${info.version} | ${info.licence} |`),
  '',
  '## Fonts',
  '',
  'Served from the application\u2019s own origin under `public/fonts`.',
  '',
  '| Font | Version | Licence |',
  '| --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.version} | ${font.licence} |`),
  '',
  '## Native libraries',
  '',
  'No shipped package bundles a native library: `jpeg-js` and `pngjs` decode and encode images',
  'in pure JavaScript, and `pg` speaks the PostgreSQL wire protocol directly.',
  ''
];

writeFileSync('THIRD_PARTY_NOTICES.md', lines.join('\n'));
process.stdout.write(`Wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
