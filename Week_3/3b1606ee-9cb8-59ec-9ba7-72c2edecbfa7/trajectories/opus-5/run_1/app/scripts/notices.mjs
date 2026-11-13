/** Writes THIRD_PARTY_NOTICES.md from the production dependency tree. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const packages = new Map();

function walk(node) {
  for (const [name, info] of Object.entries(node.dependencies ?? {})) {
    if (info.version === undefined) continue;
    if (!packages.has(name)) packages.set(name, info.version);
    walk(info);
  }
}
walk(tree);

function licenceOf(name) {
  const manifest = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(manifest)) return 'unknown';
  const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed.license === 'string') return parsed.license;
  if (typeof parsed.licenses?.[0]?.type === 'string') return parsed.licenses[0].type;
  return 'unknown';
}

const rows = [...packages.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, version]) => `| ${name} | ${version} | ${licenceOf(name)} |`);

const text = `# Third party notices

Airfold ships the packages below, which is the production tree reported by
\`npm ls --omit=dev --all --json\`, together with the self-hosted Zilla Slab font.

## Packages

| Package | Version | Licence |
| --- | --- | --- |
${rows.join('\n')}

## Font

| Font | Version | Licence |
| --- | --- | --- |
| Zilla Slab (Mozilla) | v12 (Google Fonts build) | SIL Open Font License 1.1 |

The Zilla Slab web font files in \`public/fonts\` are served by this app and are never
fetched from a font service. The full licence text is in \`licenses/ZillaSlab-OFL.txt\`.
`;

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), text);
process.stdout.write(`wrote notices for ${rows.length} packages\n`);
