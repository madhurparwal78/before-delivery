import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);

const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
const tree = JSON.parse(raw);

const found = new Map();

function walk(node) {
  const deps = node.dependencies ?? {};
  for (const [name, info] of Object.entries(deps)) {
    // An optional peer that npm did not resolve is not installed, so it is not shipped.
    if (typeof info.version !== 'string') continue;
    found.set(`${name}@${info.version}`, { name, version: info.version, path: info.path });
    walk(info);
  }
}
walk(tree);

async function licenceOf({ name, version, path }) {
  const candidates = [
    path ? `${path}/package.json` : null,
    `node_modules/${name}/package.json`,
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      const pkg = JSON.parse(await readFile(file, 'utf8'));
      if (pkg.version !== version && candidates.length > 1 && file !== candidates[0]) continue;
      if (typeof pkg.license === 'string') return pkg.license;
      if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
      if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(`No licence found for ${name}@${version}`);
}

const rows = [];
for (const entry of [...found.values()].sort((a, b) => a.name.localeCompare(b.name))) {
  const licence = await licenceOf(entry);
  if (!ALLOWED.has(licence)) {
    throw new Error(`Package ${entry.name}@${entry.version} has disallowed licence ${licence}`);
  }
  rows.push({ ...entry, licence });
}

const lines = [
  '# Third-party notices',
  '',
  'Longseat ships the packages below. Each line gives the package name, the version that',
  'is shipped and the licence it is distributed under. The list is the production',
  'dependency tree reported by `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows.map((r) => `| ${r.name} | ${r.version} | ${r.licence} |`),
  '',
  'Typography uses the STIX Two Text family when the reading device already has it, and',
  'falls back to Georgia and then Times New Roman. No font file is shipped or fetched.',
  '',
];

await writeFile('THIRD_PARTY_NOTICES.md', lines.join('\n'), 'utf8');
process.stdout.write(`THIRD_PARTY_NOTICES.md written with ${rows.length} packages\n`);
