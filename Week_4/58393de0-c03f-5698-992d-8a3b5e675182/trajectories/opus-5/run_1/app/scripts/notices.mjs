import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Zlib',
  'BlueOak-1.0.0',
  'CC0-1.0',
]);

const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' });
const tree = JSON.parse(raw);

const shipped = new Map();
const walk = (node) => {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (!shipped.has(name)) shipped.set(name, info.version ?? 'unknown');
    walk(info);
  }
};
walk(tree);

const licenceOf = async (name) => {
  let raw;
  try {
    raw = await readFile(`node_modules/${name}/package.json`, 'utf8');
  } catch {
    return null;
  }
  const manifest = JSON.parse(raw);
  if (typeof manifest.license === 'string') return manifest.license;
  if (typeof manifest.license === 'object' && manifest.license !== null) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type).join(' OR ');
  return 'UNKNOWN';
};

const rows = [];
for (const [name, version] of [...shipped.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const licence = await licenceOf(name);
  if (licence === null) continue;
  rows.push({ name, version, licence });
}

const refused = rows.filter((row) => !ALLOWED.has(row.licence));
if (refused.length > 0) {
  process.stderr.write(`Refused licences: ${refused.map((row) => `${row.name} (${row.licence})`).join(', ')}\n`);
  process.exit(1);
}

const notices = `# Third-party notices

Quarkyard ships the production packages below, as reported by \`npm ls --omit=dev --all --json\`,
together with the Fira Sans typeface. Everything else in the product — renders, doodles, geometry,
circuit solving and file building — is Quarkyard's own code.

## Shipped npm packages

| Package | Version | Licence |
|---|---|---|
${rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`).join('\n')}

## Fonts

| Font | Licence | Notes |
|---|---|---|
| Fira Sans | OFL-1.1 | Served by the app from \`/fonts\`; licence text in \`assets/fonts/FiraSans-LICENSE.txt\`. |

## Icons

Icon outlines follow the Lucide icon set (ISC licence, https://lucide.dev). They are drawn by
Quarkyard's own inline SVG markup; no Lucide package is shipped at runtime.

## Build-only tooling

esbuild (MIT) and TypeScript (Apache-2.0) are development dependencies and are not shipped.
`;

await writeFile('THIRD_PARTY_NOTICES.md', notices, 'utf8');
process.stdout.write(`[quarkyard] wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
