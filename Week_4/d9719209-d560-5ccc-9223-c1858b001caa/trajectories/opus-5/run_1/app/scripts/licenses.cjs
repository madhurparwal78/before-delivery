'use strict';
// Generates THIRD_PARTY_NOTICES.md from the production dependency tree and the bundled fonts.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'BlueOak-1.0.0',
  'SIL OFL 1.1',
  'OFL-1.1',
  'MIT-0',
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  'Unlicense',
]);

const tree = JSON.parse(
  execSync('npm ls --omit=dev --all --json', { maxBuffer: 1 << 28, cwd: path.join(__dirname, '..') }).toString(),
);
const packages = new Map();
(function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies || {})) {
    if (!info.version) continue; // optional peer that is not installed, so not shipped
    const key = `${name}@${info.version}`;
    if (!packages.has(key)) {
      packages.set(key, { name, version: info.version });
      walk(info);
    }
  }
})(tree);

const rows = [];
for (const { name, version } of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  let license = 'UNKNOWN';
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'node_modules', name, 'package.json'), 'utf8'),
    );
    license =
      typeof pkg.license === 'string'
        ? pkg.license
        : pkg.license?.type || (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN');
  } catch {
    license = 'UNKNOWN';
  }
  rows.push({ name, version, license });
}

const fonts = [
  { name: 'Bricolage Grotesque', version: 'variable', license: 'SIL OFL 1.1' },
  { name: 'Atkinson Hyperlegible', version: 'variable', license: 'SIL OFL 1.1' },
  { name: 'Atkinson Hyperlegible Mono', version: 'variable', license: 'SIL OFL 1.1' },
];

const bad = [...rows, ...fonts].filter((r) => !ALLOWED.has(r.license));
const lines = [
  '# Third-party notices',
  '',
  'Moothall ships the packages and fonts listed below. Every entry is distributed under a permissive',
  'licence (MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0 or SIL OFL 1.1).',
  '',
  '## Node packages (production dependency tree)',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Version | Licence |',
  '| --- | --- | --- |',
  ...fonts.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  '',
  'The SIL Open Font License 1.1 text for the bundled fonts is in `src/assets/fonts/OFL.txt`.',
  '',
];
fs.writeFileSync(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`wrote ${rows.length} packages, ${fonts.length} fonts`);
if (bad.length) {
  console.error('DISALLOWED LICENCES:', bad);
  process.exitCode = 1;
}
