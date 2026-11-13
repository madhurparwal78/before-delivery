// Writes THIRD_PARTY_NOTICES.md from the installed tree (run after `npm ci`): every package, runtime and build,
// with its version, licence and copyright line, plus the bundled font and its licence text.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(execFileSync('npm', ['ls', '--all', '--json', '--long'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString());
const production = new Set(collect(JSON.parse(execFileSync("npm", ["ls", "--omit=dev", "--all", "--json", "--long"], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString())).map((entry) => `${entry.name}@${entry.version}`));

function collect(node, found = new Map()) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (!dep.version || !dep.path) continue;
    found.set(`${name}@${dep.version}`, { name, version: dep.version, path: dep.path, license: dep.license ?? dep.licenses });
    collect(dep, found);
  }
  return [...found.values()];
}

function licence(entry) {
  const value = entry.license;
  if (Array.isArray(value)) return value.map((item) => (typeof item === 'string' ? item : item.type)).join(' OR ');
  return typeof value === 'object' && value ? value.type : String(value ?? 'UNKNOWN');
}

function copyright(path) {
  const file = existsSync(path) ? readdirSync(path).find((name) => /^licen[cs]e(\.md|\.txt)?$/i.test(name)) : undefined;
  if (!file) return '';
  const line = readFileSync(join(path, file), 'utf8').split('\n').find((text) => /copyright/i.test(text));
  return line ? line.trim().replace(/\|/g, '/') : '';
}

const packages = collect(tree).sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const rows = packages.map(
  (entry) => `| ${entry.name} | ${entry.version} | ${licence(entry)} | ${production.has(`${entry.name}@${entry.version}`) ? 'shipped' : 'build'} | ${copyright(entry.path)} |`,
);
const ofl = readFileSync(join(root, 'public/fonts/OFL.txt'), 'utf8');

writeFileSync(
  join(root, 'THIRD_PARTY_NOTICES.md'),
  `# Third-party notices

Airfold ships these npm packages (\`shipped\`, the production tree from \`npm ls --omit=dev --all --json\`, plus the
React packages bundled into the browser client) and is built with the others (\`build\`). Every licence is MIT, ISC,
BSD-2-Clause, BSD-3-Clause, Apache-2.0 or 0BSD.

| Package | Version | Licence | Used as | Copyright |
|---|---|---|---|---|
${rows.join('\n')}

## Fonts

**Zilla Slab** (Regular 400, Medium 500, SemiBold 600; Latin and Latin Extended subsets, self-hosted from \`/fonts\`),
SIL Open Font License 1.1. Source: Mozilla's Zilla Slab as packaged by Fontsource (https://fontsource.org/fonts/zilla-slab).

\`\`\`
${ofl.trim()}
\`\`\`

## Images

All imagery (avatar, monogram, postmarks, airmail stripe, glyphs) is drawn in code for this app (licence: original).
There are no raster, audio, video or model assets.
`,
);
console.log(`wrote ${packages.length} packages`);
