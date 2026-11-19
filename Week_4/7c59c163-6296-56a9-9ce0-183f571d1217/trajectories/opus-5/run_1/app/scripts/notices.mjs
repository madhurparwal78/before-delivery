import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
]);

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }),
);

const packages = new Map();
const walk = (node) => {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (info.version === undefined) continue;
    if (!packages.has(name)) packages.set(name, info.version);
    walk(info);
  }
};
walk(tree);

const rows = [...packages]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, version]) => {
    const manifest = JSON.parse(
      readFileSync(join('node_modules', ...name.split('/'), 'package.json'), 'utf8'),
    );
    const licence = manifest.license ?? manifest.licenses?.[0]?.type ?? 'UNKNOWN';
    return { name, version, licence };
  });

const disallowed = rows.filter((row) => !ALLOWED.has(row.licence));
if (disallowed.length > 0) {
  throw new Error(`disallowed licences: ${disallowed.map((r) => `${r.name} (${r.licence})`).join(', ')}`);
}

const lines = [
  '# Third-party notices',
  '',
  'Plumtide Venue ships the packages below. Every one is used under a permissive licence.',
  '',
  '## npm packages',
  '',
  'The production dependency tree, as reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| \`${row.name}\` | ${row.version} | ${row.licence} |`),
  '',
  '## Fonts',
  '',
  'Both font families are served by the app from `public/fonts` and are used under the',
  'SIL Open Font License 1.1.',
  '',
  '| Family | Files | Licence |',
  '| --- | --- | --- |',
  '| Parkinsans | `parkinsans-latin.woff2`, `parkinsans-latin-ext.woff2` | SIL Open Font License 1.1 |',
  '| Urbanist | `urbanist-latin.woff2`, `urbanist-latin-ext.woff2` | SIL Open Font License 1.1 |',
  '',
];

writeFileSync('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}`);
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
