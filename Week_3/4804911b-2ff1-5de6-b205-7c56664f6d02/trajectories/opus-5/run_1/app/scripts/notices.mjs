import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const packages = new Map();
(function walk(node) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version !== undefined) packages.set(name, value.version);
    walk(value);
  }
})(tree);

const rows = [];
for (const [name, version] of [...packages].sort()) {
  let licence = 'see package';
  try {
    const manifest = JSON.parse(await readFile(`${root}node_modules/${name}/package.json`, 'utf8'));
    licence =
      typeof manifest.license === 'string'
        ? manifest.license
        : Array.isArray(manifest.licenses)
          ? manifest.licenses.map((entry) => entry.type).join(', ')
          : licence;
  } catch {
    continue;
  }
  rows.push({ name, version, licence });
}

const extras = [
  { name: 'Bebas Neue (via @fontsource/bebas-neue)', version: 'shipped font files', licence: 'OFL-1.1' },
  { name: 'EB Garamond (via @fontsource/eb-garamond)', version: 'shipped font files', licence: 'OFL-1.1' },
  { name: 'Phosphor Icons (via @phosphor-icons/core)', version: 'shipped SVG icons', licence: 'MIT' },
];

const lines = [
  '# Third party notices',
  '',
  'Interval ships the production dependency tree below, plus the fonts and icon set listed after it.',
  'Every pack image is procedural: no photo, raster pack image or 3D model file ships with this app.',
  '',
  '## Shipped packages (`npm ls --omit=dev --all`)',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Shipped fonts and icons',
  '',
  '| Asset | Shipped as | Licence |',
  '| --- | --- | --- |',
  ...extras.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
];

await writeFile(`${root}THIRD_PARTY_NOTICES.md`, `${lines.join('\n')}`);
console.log(`wrote ${rows.length} packages`);
