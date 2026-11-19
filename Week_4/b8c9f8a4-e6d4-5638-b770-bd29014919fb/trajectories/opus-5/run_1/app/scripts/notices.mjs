import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALLOWED = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'CC0-1.0',
  'BlueOak-1.0.0',
  'OFL-1.1',
  'LGPL-3.0-or-later',
]);

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
);

const names = new Set();
// An entry with no resolved version is an optional package for another platform,
// which npm lists but does not install, so it is not shipped.
const collect = (node) => {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (typeof child.version === 'string') names.add(name);
    collect(child);
  }
};
collect(tree);

const licenceOf = (name) => {
  const pkgPath = join('node_modules', name, 'package.json');
  if (!existsSync(pkgPath)) return 'UNKNOWN';
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type).join(' OR ');
  return 'UNKNOWN';
};

const rows = [...names].sort().map((name) => ({ name, licence: licenceOf(name) }));
const disallowed = rows.filter((r) => !ALLOWED.has(r.licence));
if (disallowed.length > 0) {
  console.error('Shipped packages with a licence outside the allowed set:', disallowed);
  process.exit(1);
}

const body = `# Third party notices

Open Bonnet ships the packages below, which make up the production dependency
tree reported by \`npm ls --omit=dev --all --json\`, together with the Outfit
typeface. Every other image, mark, 3D shape and terrain in this product is made
in this project.

## Typeface

| Name | Licence |
|---|---|
| Outfit (self-hosted, \`public/fonts/outfit-latin.woff2\` and \`public/fonts/outfit-latin-ext.woff2\`) | OFL-1.1 |

## Shipped packages

| Package | Licence |
|---|---|
${rows.map((r) => `| ${r.name} | ${r.licence} |`).join('\n')}
`;

writeFileSync('THIRD_PARTY_NOTICES.md', body);
console.log(`THIRD_PARTY_NOTICES.md written for ${rows.length} shipped packages.`);
