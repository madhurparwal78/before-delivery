import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

const ALLOWED_LICENCES = [
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'Unlicense',
  'BlueOak-1.0.0',
  'SIL OFL 1.1',
];

interface TreeNode {
  version?: string;
  dependencies?: Record<string, TreeNode>;
}

interface ShippedPackage {
  name: string;
  version: string;
  licence: string;
}

interface BundledFont {
  family: string;
  package: string;
  version: string;
  licence: string;
}

const FONTS: { family: string; package: string }[] = [
  { family: 'Fraunces', package: '@fontsource/fraunces' },
  { family: 'IBM Plex Sans', package: '@fontsource/ibm-plex-sans' },
  { family: 'IBM Plex Mono', package: '@fontsource/ibm-plex-mono' },
];

const ICONS = { name: 'lucide-static', note: 'Lucide icon paths bundled into the app' };

async function licenceOf(name: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
  ) as { license?: string | { type?: string }; licenses?: { type?: string }[] };
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (manifest.licenses?.[0]?.type) return manifest.licenses[0].type;
  return 'UNKNOWN';
}

function collect(node: TreeNode, into: Map<string, string>): void {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (child.version) into.set(name, child.version);
    collect(child, into);
  }
}

async function main(): Promise<void> {
  const output = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' });
  const tree = JSON.parse(output) as TreeNode;
  const versions = new Map<string, string>();
  collect(tree, versions);

  const packages: ShippedPackage[] = [];
  for (const [name, version] of [...versions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    packages.push({ name, version, licence: await licenceOf(name) });
  }

  const fonts: BundledFont[] = [];
  for (const font of FONTS) {
    const manifest = JSON.parse(
      await readFile(join(root, 'node_modules', font.package, 'package.json'), 'utf8'),
    ) as { version: string };
    fonts.push({ ...font, version: manifest.version, licence: 'SIL OFL 1.1' });
  }
  const iconsVersion = (
    JSON.parse(await readFile(join(root, 'node_modules', ICONS.name, 'package.json'), 'utf8')) as {
      version: string;
    }
  ).version;

  const rows = packages
    .map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`)
    .join('\n');
  const fontRows = fonts
    .map((font) => `| ${font.family} (${font.package}) | ${font.version} | ${font.licence} |`)
    .join('\n');

  const notices = `# Third party notices

Cairn ships the packages and fonts below. Every licence is one of
${ALLOWED_LICENCES.join(', ')}.

## Shipped packages

These are the production dependencies reported by \`npm ls --omit=dev --all --json\`.

| Package | Version | Licence |
| --- | --- | --- |
${rows}

## Bundled fonts

Self-hosted from the Fontsource packages; only the Latin woff2 files are shipped.

| Font | Version | Licence |
| --- | --- | --- |
${fontRows}

## Bundled icons

| Source | Version | Licence |
| --- | --- | --- |
| ${ICONS.name} (${ICONS.note}) | ${iconsVersion} | ISC |
`;

  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), notices, 'utf8');

  const offenders = packages.filter((entry) => !ALLOWED_LICENCES.includes(entry.licence));
  if (offenders.length > 0) {
    process.stderr.write(`licences outside the allowlist: ${offenders.map((entry) => `${entry.name} (${entry.licence})`).join(', ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`THIRD_PARTY_NOTICES.md lists ${packages.length} packages, ${fonts.length} fonts and 1 icon set\n`);
}

await main();
