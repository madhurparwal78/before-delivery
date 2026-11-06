// Writes THIRD_PARTY_NOTICES.md from the production dependency tree and the bundled fonts.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'OFL-1.1',
  'LGPL-3.0-only',
  'LGPL-3.0-or-later',
  'LGPL-3.0',
]);

function licenceOf(name) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (typeof pkg.license === 'string') return pkg.license;
    if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type !== undefined) return pkg.licenses[0].type;
  } catch {
    // A package without a manifest is reported as unknown and fails the check below.
  }
  return 'UNKNOWN';
}

const tree = JSON.parse(
  execSync('npm ls --omit=dev --all --json', { cwd: root, maxBuffer: 1 << 26 }).toString(),
);

const packages = new Map();
const walk = (dependencies) => {
  for (const [name, info] of Object.entries(dependencies ?? {})) {
    if (info.version === undefined) continue;
    const key = `${name}@${info.version}`;
    if (!packages.has(key)) packages.set(key, { name, version: info.version, licence: licenceOf(name) });
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

const FONTS = [
  { name: 'Archivo', version: '5.2.5 (@fontsource/archivo)', licence: 'OFL-1.1' },
  { name: 'Public Sans', version: '5.2.5 (@fontsource/public-sans)', licence: 'OFL-1.1' },
];

const rows = [...packages.values()].sort((left, right) => left.name.localeCompare(right.name));
const unallowed = [...rows, ...FONTS].filter((row) =>
  !row.licence.split(/ AND | OR /).every((part) => ALLOWED.has(part.replace(/[()]/g, ''))),
);
if (unallowed.length > 0) {
  console.error('licences outside the allowed set:', unallowed);
  process.exit(1);
}

const lines = [
  '# Third-party notices',
  '',
  'Clinchline ships the production dependency tree below, as reported by',
  '`npm ls --omit=dev --all --json`, together with the two bundled typefaces. Every',
  'licence here is one of the licences the working rules allow.',
  '',
  '## Shipped packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Typeface | Source | Licence |',
  '| --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.version} | ${font.licence} |`),
  '',
  '## Notes',
  '',
  '- `libheif-js` and its bundled libheif build are used only to decode HEIC uploads;',
  '  they are LGPL-3.0 licensed and are used as unmodified libraries.',
  '- `sharp` bundles prebuilt libvips binaries for the host platform; the combined',
  '  notice above reflects the licences those binaries carry.',
  '- The fonts are served from the app itself, so the browser loads nothing from a',
  '  third-party host.',
  '',
];

writeFileSync(resolve(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`);
console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages and ${FONTS.length} fonts`);
