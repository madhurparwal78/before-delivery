import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root }).toString());

const packages = new Map();

function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.missing || entry.extraneous) continue;
    const manifest = join(root, 'node_modules', name, 'package.json');
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    packages.set(name, { version: parsed.version, license: parsed.license ?? 'UNKNOWN' });
    walk(entry);
  }
}

walk(tree);

const lines = [
  '# Third party notices',
  '',
  'Rulehouse ships the production dependency tree below. Each package keeps its own licence.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...[...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, entry]) => `| ${name} | ${entry.version} | ${entry.license} |`),
  '',
];

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
process.stdout.write(`${packages.size} packages listed\n`);
