import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const allowed = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'OFL-1.1',
]);

const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const tree = JSON.parse(raw);

const found = new Map();
function walk(node) {
  for (const [name, dep] of Object.entries(node.dependencies ?? {})) {
    if (dep.missing || typeof dep.version !== 'string') continue;
    const key = `${name}@${dep.version}`;
    if (!found.has(key)) found.set(key, { name, version: dep.version });
    walk(dep);
  }
}
walk(tree);

async function licenseOf(name) {
  const file = path.join(root, 'node_modules', name, 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
  throw new Error(`no licence declared for ${name}`);
}

const rows = [];
for (const { name, version } of [...found.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const license = await licenseOf(name);
  rows.push({ name, version, license });
}

const assets = [
  { name: 'Fira Sans', version: 'bundled woff2 subset from @fontsource/fira-sans', license: 'OFL-1.1' },
  { name: 'Lucide icons', version: 'bundled from lucide-react', license: 'ISC' },
];

const offenders = [...rows, ...assets].filter((r) => !allowed.has(r.license));
if (offenders.length > 0) {
  throw new Error(`disallowed licences: ${offenders.map((o) => `${o.name} (${o.license})`).join(', ')}`);
}

const lines = [
  '# Third-party notices',
  '',
  'Corbel Draft ships the packages, fonts and icon sets listed below.',
  '',
  '## Shipped packages',
  '',
  'The production dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.license} |`),
  '',
  '## Bundled fonts and icons',
  '',
  '| Asset | Source | Licence |',
  '| --- | --- | --- |',
  ...assets.map((a) => `| ${a.name} | ${a.version} | ${a.license} |`),
  '',
];

await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'), 'utf8');
process.stdout.write(`THIRD_PARTY_NOTICES.md: ${rows.length} packages, ${assets.length} assets\n`);
