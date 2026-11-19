import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const allowed = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'MPL-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
]);

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root }).toString());
const packages = new Map();
const walk = (node) => {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (!child.version) continue;
    if (!packages.has(name)) {
      let licence = 'UNKNOWN';
      try {
        const meta = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
        licence = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'UNKNOWN');
      } catch {
        licence = 'UNKNOWN';
      }
      packages.set(name, { version: child.version, licence });
    }
    walk(child);
  }
};
walk(tree);

const fontPackages = new Set(['@fontsource/poppins', '@fontsource/noto-sans', '@fontsource/noto-nastaliq-urdu']);
const problems = [];
for (const [name, info] of packages) {
  const wanted = fontPackages.has(name) ? info.licence === 'OFL-1.1' : allowed.has(info.licence);
  if (!wanted) problems.push(`${name}@${info.version}: ${info.licence}`);
}
if (problems.length) {
  throw new Error(`licence not allowed:\n${problems.join('\n')}`);
}

const rows = [...packages.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
const lines = [
  '# Third party notices',
  '',
  'Wayticket ships the production dependency tree below (`npm ls --omit=dev --all --json`).',
  'Each package is used under the licence named beside it; each licence text is in that package inside `node_modules`.',
  '',
  '## Packages',
  '',
  '| Package | Version | Licence |',
  '|---|---|---|',
  ...rows.map(([name, info]) => `| \`${name}\` | ${info.version} | ${info.licence} |`),
  '',
  '## Fonts',
  '',
  'The three typefaces are shipped from the font packages above, as WOFF2 files served by this app itself and from no other host.',
  '',
  '| Font | Package | Licence |',
  '|---|---|---|',
  `| Poppins | \`@fontsource/poppins\` | ${packages.get('@fontsource/poppins')?.licence ?? 'OFL-1.1'} |`,
  `| Noto Sans | \`@fontsource/noto-sans\` | ${packages.get('@fontsource/noto-sans')?.licence ?? 'OFL-1.1'} |`,
  `| Noto Nastaliq Urdu | \`@fontsource/noto-nastaliq-urdu\` | ${packages.get('@fontsource/noto-nastaliq-urdu')?.licence ?? 'OFL-1.1'} |`,
  '',
  '## Imagery',
  '',
  'Every coach drawing, seat plan, client mark and icon in this app is generated SVG written for this project, or a file uploaded by a user. No image, icon, text or code is taken from any other site.',
  '',
];
writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`THIRD_PARTY_NOTICES.md: ${rows.length} packages`);
