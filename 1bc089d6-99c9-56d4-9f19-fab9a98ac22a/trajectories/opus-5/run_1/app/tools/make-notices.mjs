// Writes THIRD_PARTY_NOTICES.md from the production dependency tree and the bundled fonts.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }));

const packages = new Map();
const walk = (node) => {
  for (const [name, detail] of Object.entries(node.dependencies ?? {})) {
    if (!detail.version) continue;
    if (!packages.has(name)) packages.set(name, detail.version);
    walk(detail);
  }
};
walk(tree);

const licenceOf = (name) => {
  const manifest = `${root}node_modules/${name}/package.json`;
  if (!existsSync(manifest)) return 'unknown';
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed.license === 'string') return parsed.license;
  if (parsed.license?.type) return parsed.license.type;
  if (Array.isArray(parsed.licenses)) return parsed.licenses.map((it) => it.type).join(' OR ');
  return 'unknown';
};

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);

const rows = [...packages.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([name, version]) => ({ name, version, licence: licenceOf(name) }));

const refused = rows.filter((row) => !ALLOWED.has(row.licence));
if (refused.length > 0) {
  console.error('licences outside the allowed set:', refused);
  process.exitCode = 1;
}

const notices = `# Third-party notices

Stillhour ships the packages and fonts listed here. Everything else in the repository is the
application's own code, including every 3D scene, audio file, film and texture.

## Shipped packages

These are the production dependencies reported by \`npm ls --omit=dev --all --json\`.

| Package | Version | Licence |
| --- | --- | --- |
${rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`).join('\n')}

## Bundled fonts

| Font | Files | Licence |
| --- | --- | --- |
| Fraunces (Undercase Type) | \`public/fonts/fraunces-latin-variable.woff2\` | SIL Open Font License 1.1 (\`public/fonts/Fraunces-OFL.txt\`) |
| Hanken Grotesk (Alfredo Marco Pradil) | \`public/fonts/hanken-grotesk-latin-variable.woff2\` | SIL Open Font License 1.1 (\`public/fonts/HankenGrotesk-OFL.txt\`) |

The full licence text for each font is served from the application itself at
\`/fonts/Fraunces-OFL.txt\` and \`/fonts/HankenGrotesk-OFL.txt\`.
`;

writeFileSync(`${root}THIRD_PARTY_NOTICES.md`, notices);
console.log(`${rows.length} shipped packages recorded`);
