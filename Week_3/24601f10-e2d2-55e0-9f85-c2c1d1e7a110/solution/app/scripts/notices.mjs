// Regenerates THIRD_PARTY_NOTICES.md from the installed dependency tree (run after `npm ci`).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const tree = JSON.parse(execFileSync('npm', ['ls', '--all', '--json', '--long'], { encoding: 'utf8', maxBuffer: 1 << 28 }));
const found = new Map();
const walk = (node, dev) => {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (!dep.version || dep.missing) continue;
    const manifest = JSON.parse(readFileSync(`${dep.path}/package.json`, 'utf8'));
    const licence = typeof manifest.license === 'string' ? manifest.license : manifest.license?.type ?? 'UNKNOWN';
    const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name ?? manifest.repository?.url ?? '';
    const key = `${name}@${dep.version}`;
    const known = found.get(key);
    found.set(key, { name, version: dep.version, licence, author, dev: (known?.dev ?? true) && dev });
    walk(dep, dev);
  }
};
const direct = JSON.parse(readFileSync('package.json', 'utf8'));
const production = new Set(Object.keys(direct.dependencies ?? {}));
for (const [name, dep] of Object.entries(tree.dependencies ?? {})) {
  const dev = !production.has(name);
  walk({ dependencies: { [name]: dep } }, dev);
}
const rows = [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const table = rows.map((p) => `| ${p.name} | ${p.version} | ${p.licence} | ${p.author.replace(/\|/g, '/')} |`).join('\n');
const ofl = readFileSync('public/fonts/OFL.txt', 'utf8');
writeFileSync('THIRD_PARTY_NOTICES.md', `# Third-party notices

Cupfold ships the packages and the font listed here. Every licence is one of MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD or OFL-1.1. Run \`node scripts/notices.mjs\` after \`npm ci\` to regenerate the package table.

## Packages (production tree and build tools, with transitive dependencies)

| Package | Version | Licence | Author or source |
|---|---|---|---|
${table}

## Font

| File | Family | Licence | Source |
|---|---|---|---|
| public/fonts/geist-latin-wght-normal.woff2 | Geist (variable) | OFL-1.1 | https://github.com/vercel/geist-font via @fontsource-variable/geist |
| public/fonts/geist-latin-ext-wght-normal.woff2 | Geist (variable) | OFL-1.1 | https://github.com/vercel/geist-font via @fontsource-variable/geist |

Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)

### SIL Open Font License 1.1 (Geist)

${ofl}
`);
console.log(`${rows.length} packages listed`);
