import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const FONTS = [
  {
    name: 'Bricolage Grotesque',
    files: 'bricolage-grotesque-latin-600-normal.woff2, bricolage-grotesque-latin-700-normal.woff2',
    licence: 'OFL-1.1',
  },
  {
    name: 'Public Sans',
    files:
      'public-sans-latin-400-normal.woff2, public-sans-latin-600-normal.woff2, public-sans-latin-700-normal.woff2',
    licence: 'OFL-1.1',
  },
  {
    name: 'JetBrains Mono',
    files: 'jetbrains-mono-latin-400-normal.woff2, jetbrains-mono-latin-500-normal.woff2',
    licence: 'OFL-1.1',
  },
];

function collect(node, into) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    const version = info.version;
    if (!version) continue;
    const key = `${name}@${version}`;
    if (!into.has(key)) {
      let licence = 'UNKNOWN';
      try {
        const manifest = JSON.parse(
          readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8'),
        );
        licence = manifest.license ?? 'UNKNOWN';
      } catch {
        licence = 'UNKNOWN';
      }
      into.set(key, { name, version, licence });
    }
    collect(info, into);
  }
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: ROOT, encoding: 'utf8' }),
);
const packages = new Map();
collect(tree, packages);
const rows = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));

const lines = [
  '# Third-party notices',
  '',
  'Stationkeeper ships the production packages and the bundled fonts listed below.',
  '',
  '## Shipped packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Bundled fonts',
  '',
  'Served from `public/fonts` by the application itself; no third-party font host is used.',
  '',
  '| Font | Files | Licence |',
  '| --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.files} | ${font.licence} |`),
  '',
];

writeFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`Wrote ${rows.length} packages and ${FONTS.length} fonts.`);
