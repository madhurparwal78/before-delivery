// Writes THIRD_PARTY_NOTICES.md from the production dependency tree.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PERMISSIVE = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
  'SIL OFL 1.1',
]);

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  }),
);

const shipped = new Map();
// An extraneous package is not in package-lock.json, so `npm ci` never installs it and
// it is not shipped; its whole subtree is skipped.
(function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.extraneous === true) continue;
    if (entry.version !== undefined && !shipped.has(name)) shipped.set(name, entry.version);
    walk(entry);
  }
})(tree);

const rows = [];
for (const [name, version] of [...shipped.entries()].sort()) {
  const manifest = JSON.parse(
    await readFile(join('node_modules', name, 'package.json'), 'utf8'),
  );
  const licence =
    typeof manifest.license === 'string'
      ? manifest.license
      : (manifest.license?.type ?? manifest.licenses?.[0]?.type ?? 'UNKNOWN');
  const files = readdirSync(join('node_modules', name)).filter((file) =>
    /^(LICENSE|LICENCE|COPYING)/i.test(file),
  );
  rows.push({ name, version, licence, files });
}

const notPermissive = rows.filter((row) => !PERMISSIVE.has(row.licence));
if (notPermissive.length > 0) {
  console.error('Not permissive:', notPermissive);
  process.exitCode = 1;
}

const lines = [
  '# Third party notices',
  '',
  'Ourlet Consignment Desk ships the packages below. Every licence is permissive.',
  '',
  '## Shipped packages',
  '',
  'These are the production dependency tree, as given by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence | Licence file |',
  '| --- | --- | --- | --- |',
  ...rows.map(
    (row) =>
      `| \`${row.name}\` | ${row.version} | ${row.licence} | ${
        row.files.length === 0 ? '—' : `\`node_modules/${row.name}/${row.files[0]}\``
      } |`,
  ),
  '',
  '## Shipped fonts',
  '',
  'Both typefaces are shipped inside this repository under the SIL Open Font License 1.1.',
  '',
  '| Font | Files | Licence |',
  '| --- | --- | --- |',
  '| Familjen Grotesk | `public/fonts/familjen-grotesk-latin.woff2`, `public/fonts/familjen-grotesk-latin-ext.woff2` | SIL OFL 1.1 — `public/fonts/OFL-Familjen-Grotesk.txt` |',
  '| Hanken Grotesk | `public/fonts/hanken-grotesk-latin.woff2`, `public/fonts/hanken-grotesk-latin-ext.woff2` | SIL OFL 1.1 — `public/fonts/OFL-Hanken-Grotesk.txt` |',
  '',
  '## Shipped icon artwork',
  '',
  'The icon outlines in `src/client/components/Icon.tsx` are drawn from Lucide',
  '(<https://lucide.dev>), which is licensed ISC. No icon package is installed.',
  '',
];

await writeFile('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}\n`);
console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages`);
