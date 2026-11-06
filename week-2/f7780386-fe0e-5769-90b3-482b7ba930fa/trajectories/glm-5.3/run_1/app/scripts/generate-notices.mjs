// Generates THIRD_PARTY_NOTICES.md from the production dependency tree
// reported by `npm ls --omit=dev --all --json`, plus the bundled fonts.
// Run with: node scripts/generate-notices.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0']);

const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' });
const tree = JSON.parse(raw);

const names = new Map();
function walk(node) {
  if (!node.dependencies) return;
  for (const [name, dep] of Object.entries(node.dependencies)) {
    if (!names.has(name)) names.set(name, dep.version ?? '');
    walk(dep);
  }
}
walk(tree);

// Locate each installed package on disk; entries that are not installed
// (optional dependencies) are not shipped and are skipped.
function findPackage(name) {
  const direct = `node_modules/${name}/package.json`;
  if (existsSync(direct)) return direct;
  try {
    for (const scope of readdirSync('node_modules')) {
      const nested = `node_modules/${scope}/node_modules/${name}/package.json`;
      if (existsSync(nested)) return nested;
    }
  } catch {
    // node_modules unreadable
  }
  return null;
}

const rows = [];
for (const [name, version] of names) {
  const path = findPackage(name);
  if (!path) continue; // not installed, not shipped
  const pkg = JSON.parse(readFileSync(path, 'utf8'));
  rows.push({
    name,
    version: pkg.version ?? version,
    license: Array.isArray(pkg.license) ? pkg.license.join(' OR ') : pkg.license ?? '',
  });
}

const lines = ['# Third-party notices', '', 'Passboard ships the following packages and bundled fonts.', '', '## Packages', ''];
lines.push('| Name | Version | Licence |');
lines.push('|---|---|---|');
let failed = false;
for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
  const allowed = String(row.license)
    .split(/\s+OR\s+/)
    .some((l) => ALLOWED.has(l));
  if (!allowed) {
    console.error(`Disallowed licence for ${row.name}@${row.version}: ${row.license}`);
    failed = true;
  }
  lines.push(`| ${row.name} | ${row.version} | ${row.license} |`);
}
lines.push('');
lines.push('## Fonts');
lines.push('');
lines.push('| Name | Version | Licence |');
lines.push('|---|---|---|');
lines.push('| Big Shoulders Display (latin 400, latin 700) | 1.0.0 | OFL-1.1 |');
lines.push('| Public Sans (latin 400, latin 700) | 1.0.0 | OFL-1.1 |');
lines.push('');

writeFileSync('THIRD_PARTY_NOTICES.md', lines.join('\n'));
console.log(`THIRD_PARTY_NOTICES.md written with ${rows.length} packages`);
if (failed) process.exitCode = 1;

