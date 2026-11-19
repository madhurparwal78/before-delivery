import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const tree = JSON.parse(raw);

const found = new Map();
const walk = (deps) => {
  for (const [name, node] of Object.entries(deps ?? {})) {
    if (node.version) found.set(`${name}@${node.version}`, { name, version: node.version });
    walk(node.dependencies);
  }
};
walk(tree.dependencies);

const licenceOf = async (name) => {
  const text = await readFile(path.join(root, 'node_modules', name, 'package.json'), 'utf8');
  const manifest = JSON.parse(text);
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses)) return manifest.licenses.map((l) => l.type).join(' OR ');
  throw new Error(`no licence declared for ${name}`);
};

const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'OFL-1.1']);

const rows = [];
for (const { name, version } of [...found.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const licence = await licenceOf(name);
  if (!allowed.has(licence)) throw new Error(`disallowed licence ${licence} for ${name}`);
  rows.push({ name, version, licence });
}

const fonts = [
  { name: 'Inter', version: '5.2.5 (@fontsource/inter)', licence: 'OFL-1.1' },
  { name: 'Space Grotesk', version: '5.2.5 (@fontsource/space-grotesk)', licence: 'OFL-1.1' },
  { name: 'JetBrains Mono', version: '5.2.5 (@fontsource/jetbrains-mono)', licence: 'OFL-1.1' },
];

const lines = [
  '# Third-party notices',
  '',
  'Lowfield Console ships the production dependency tree listed below',
  '(`npm ls --omit=dev --all --json`) together with the bundled font files.',
  '',
  '## Shipped packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Source | Licence |',
  '| --- | --- | --- |',
  ...fonts.map((f) => `| ${f.name} | ${f.version} | ${f.licence} |`),
  '',
];

await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
console.log(`notices written for ${rows.length} packages`);
