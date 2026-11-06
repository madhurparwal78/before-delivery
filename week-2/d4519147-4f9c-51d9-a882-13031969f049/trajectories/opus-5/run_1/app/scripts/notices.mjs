import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 }),
);

const found = new Map();
function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (dep.version === undefined) continue;
    const key = `${name}@${dep.version}`;
    if (!found.has(key)) {
      let licence = 'unknown';
      const pkgPath = join(root, 'node_modules', name, 'package.json');
      if (existsSync(pkgPath)) {
        const meta = JSON.parse(readFileSync(pkgPath, 'utf8'));
        licence = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'unknown');
      }
      found.set(key, { name, version: dep.version, licence });
    }
    walk(dep);
  }
}
walk(tree);

const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const lines = [
  '# Third-party notices',
  '',
  'Scopewright ships the production packages, fonts and icons listed below.',
  '',
  '## Shipped npm packages',
  '',
  'The list is the production dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font family | Version | Licence |',
  '| --- | --- | --- |',
  '| IBM Plex Sans (`@fontsource/ibm-plex-sans` woff2 subset) | 5.1.1 | SIL OFL-1.1 |',
  '| IBM Plex Sans Condensed (`@fontsource/ibm-plex-sans-condensed` woff2 subset) | 5.1.1 | SIL OFL-1.1 |',
  '| IBM Plex Mono (`@fontsource/ibm-plex-mono` woff2 subset) | 5.1.1 | SIL OFL-1.1 |',
  '',
  '## Bundled icon sets',
  '',
  '| Icon set | Version | Licence |',
  '| --- | --- | --- |',
  '| None. Every icon in the app is an original inline SVG line drawing authored for Scopewright. | n/a | n/a |',
  '',
];
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`notices written for ${rows.length} packages`);
