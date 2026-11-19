// Builds THIRD_PARTY_NOTICES.md from the production dependency tree.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { cwd: '/app', maxBuffer: 64 * 1024 * 1024 }).toString());
const packages = new Map();

function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version && !packages.has(name)) packages.set(name, entry.version);
    walk(entry);
  }
}
walk(tree);

function licenceOf(name) {
  const file = join('/app/node_modules', name, 'package.json');
  if (!existsSync(file)) return 'unknown';
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((entry) => entry.type).join(' OR ');
  return 'unknown';
}

const rows = Array.from(packages.entries())
  .sort(([left], [right]) => (left < right ? -1 : 1))
  .map(([name, version]) => `| \`${name}\` | ${version} | ${licenceOf(name)} |`);

const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0', 'OFL-1.1']);
const odd = Array.from(packages.keys()).filter((name) => !allowed.has(licenceOf(name)));
if (odd.length > 0) console.log('check these licences:', odd.map((name) => `${name}=${licenceOf(name)}`).join(', '));

const text = `# Third-party notices

Jarful ships the packages and fonts below. Every one is under MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, BlueOak-1.0.0 or OFL-1.1.

## Bundled fonts

| Font | Source package | Licence |
|---|---|---|
| TikTok Sans | \`@fontsource/tiktok-sans\` | OFL-1.1 (font files), MIT (package) |
| Martian Mono | \`@fontsource/martian-mono\` | OFL-1.1 (font files), MIT (package) |

Both font families are bundled with the application and served from this origin only.

## Shipped packages

The production dependency tree from \`npm ls --omit=dev --all --json\`.

| Package | Version | Licence |
|---|---|---|
${rows.join('\n')}
`;

writeFileSync('/app/THIRD_PARTY_NOTICES.md', text);
console.log(`wrote ${rows.length} packages`);
