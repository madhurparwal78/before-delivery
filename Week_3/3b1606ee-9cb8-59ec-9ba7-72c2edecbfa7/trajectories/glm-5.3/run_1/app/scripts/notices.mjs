// Regenerates THIRD_PARTY_NOTICES.md from the installed production tree.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const paths = execSync('npm ls --omit=dev --parseable --all', { encoding: 'utf8' })
  .split('\n').map((line) => line.trim())
  .filter((line) => line.includes('node_modules') && fs.existsSync(`${line}/package.json`));

const rows = new Map();
for (const path of paths) {
  const pkg = JSON.parse(fs.readFileSync(`${path}/package.json`, 'utf8'));
  if (rows.has(pkg.name)) continue;
  let licence = pkg.license ?? null;
  if (!licence && pkg.licenses) {
    licence = Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type).join(' OR ') : pkg.licenses.type;
  }
  rows.set(pkg.name, { name: pkg.name, version: pkg.version, licence });
}

const list = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
const whitelist = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);
const outside = list.filter((row) => !whitelist.has(row.licence));
if (outside.length > 0) {
  console.error('Packages outside the licence whitelist:', outside);
  process.exit(1);
}

const lines = list.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`);
const content = `# Third-party notices

Every package shipped in the production tree (from \`npm ls --omit=dev --all\`), with its version and licence, plus the Zilla Slab font and its licence.

## Shipped packages

| Package | Version | Licence |
|---|---|---|
${lines.join('\n')}

## Fonts

**Zilla Slab** - Copyright 2017, The Mozilla Foundation. Licensed under the SIL Open Font License, Version 1.1, shipped at \`public/fonts/OFL.txt\`. The three weights bundled here (regular, medium, semibold) are compiled from the Mozilla Zilla Slab sources and subset to the Latin range the app uses.
`;
fs.writeFileSync('THIRD_PARTY_NOTICES.md', content);
console.log(`THIRD_PARTY_NOTICES.md: ${list.length} packages, all whitelisted`);
