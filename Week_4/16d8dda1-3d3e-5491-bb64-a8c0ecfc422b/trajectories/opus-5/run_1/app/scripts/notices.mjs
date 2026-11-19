import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0']);

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }));
const packages = new Map();

function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version !== undefined) {
      packages.set(`${name}@${entry.version}`, { name, version: entry.version, path: entry.path ?? null });
    }
    walk(entry);
  }
}
walk(tree);

const rows = [];
for (const { name, version, path } of [...packages.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const manifest = JSON.parse(await readFile(`${path ?? `node_modules/${name}`}/package.json`, 'utf8'));
  const licence = typeof manifest.license === 'string' ? manifest.license : (manifest.licenses?.[0]?.type ?? 'UNKNOWN');
  if (!allowed.has(licence)) throw new Error(`${name}@${version} is licensed ${licence}, which is not allowed`);
  rows.push({ name, version, licence });
}

const lines = [
  '# Third-party notices',
  '',
  'Slatehall ships the packages below, which make up the production dependency tree',
  'reported by `npm ls --omit=dev --all --json`. Each is used under the licence named.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`),
  ''
];
await writeFile('THIRD_PARTY_NOTICES.md', lines.join('\n'));
process.stdout.write(`wrote notices for ${rows.length} packages\n`);
