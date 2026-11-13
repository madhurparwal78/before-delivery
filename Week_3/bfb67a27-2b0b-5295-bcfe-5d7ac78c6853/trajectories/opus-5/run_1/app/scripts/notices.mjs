import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

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
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const packages = new Map();
function walk(node) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    // Optional peers that npm records but never installed are not shipped.
    if (child.extraneous === true || typeof child.version !== 'string') continue;
    packages.set(`${name}@${child.version}`, { name, version: child.version });
    walk(child);
  }
}
walk(tree);

async function licenceOf(name) {
  for (const candidate of [join(root, 'node_modules', name, 'package.json')]) {
    try {
      const manifest = JSON.parse(await readFile(candidate, 'utf8'));
      if (typeof manifest.license === 'string') return manifest.license;
      if (typeof manifest.license?.type === 'string') return manifest.license.type;
      if (Array.isArray(manifest.licenses) && typeof manifest.licenses[0]?.type === 'string') {
        return manifest.licenses[0].type;
      }
    } catch {
      /* fall through to the unknown case below */
    }
  }
  return 'UNKNOWN';
}

const rows = [];
for (const entry of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  rows.push({ ...entry, licence: await licenceOf(entry.name) });
}

const offenders = rows.filter((row) => !ALLOWED.has(row.licence));
if (offenders.length > 0) {
  throw new Error(
    `Disallowed licences: ${offenders.map((r) => `${r.name}@${r.version} (${r.licence})`).join(', ')}`,
  );
}

const lines = [
  '# Third-party notices',
  '',
  'Tallyslate ships the production dependency tree below, together with two',
  'self-hosted fonts and one icon set. Every entry is used under the licence named.',
  '',
  '## npm packages',
  '',
  `Taken from \`npm ls --omit=dev --all --json\`. ${rows.length} packages.`,
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Fonts',
  '',
  '| Font | Source | Licence |',
  '| --- | --- | --- |',
  '| Big Shoulders Display | Google Fonts (`public/fonts/big-shoulders-display-latin.woff2`) | OFL-1.1 |',
  '| IBM Plex Sans | Google Fonts (`public/fonts/ibm-plex-sans-latin.woff2`) | OFL-1.1 |',
  '',
  '## Icons',
  '',
  '| Icon set | Use | Licence |',
  '| --- | --- | --- |',
  '| Lucide | Icon path data drawn as procedural SVG in `src/client/dom.ts` | ISC |',
  '',
];

await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`, 'utf8');
process.stdout.write(`Wrote notices for ${rows.length} packages\n`);
