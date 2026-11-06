import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface TreeNode {
  version?: string;
  dependencies?: Record<string, TreeNode>;
}

const KNOWN_LICENCES: Record<string, string> = {
  '@types/react': 'MIT',
  'pg-native': 'MIT',
  remix: 'MIT',
};

const FONTS = [
  ['Fraunces', '@fontsource/fraunces', 'SIL OFL 1.1'],
  ['IBM Plex Sans', '@fontsource/ibm-plex-sans', 'SIL OFL 1.1'],
  ['IBM Plex Sans Condensed', '@fontsource/ibm-plex-sans-condensed', 'SIL OFL 1.1'],
  ['IBM Plex Mono', '@fontsource/ibm-plex-mono', 'SIL OFL 1.1'],
];

function licenceOf(name: string): string {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join('node_modules', name, 'package.json'), 'utf8'),
    ) as { license?: string | { type?: string }; licenses?: Array<{ type?: string }> };
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license?.type !== undefined) return manifest.license.type;
    const first = manifest.licenses?.[0]?.type;
    if (first !== undefined) return first;
  } catch {
    /* an unmet optional peer has no installed manifest */
  }
  return KNOWN_LICENCES[name] ?? 'unknown';
}

const output = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { maxBuffer: 64 * 1024 * 1024 });
const tree = JSON.parse(output.toString()) as TreeNode;
const packages = new Map<string, string>();

function walk(node: TreeNode): void {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    if (!packages.has(name)) {
      packages.set(name, child.version ?? '');
      walk(child);
    }
  }
}
walk(tree);

const lines: string[] = [
  '# Third party notices',
  '',
  'Bellroll ships the packages and fonts below. Every one is used under the licence named.',
  '',
  '## Packages',
  '',
  'The production dependency tree, as `npm ls --omit=dev --all --json` reports it.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
];
for (const name of [...packages.keys()].sort()) {
  lines.push(`| ${name} | ${packages.get(name) ?? ''} | ${licenceOf(name)} |`);
}
lines.push('', '## Fonts', '', '| Font | Package | Licence |', '| --- | --- | --- |');
for (const [font, pkg, licence] of FONTS) lines.push(`| ${font} | ${pkg} | ${licence} |`);
lines.push(
  '',
  '## Icons',
  '',
  '| Icons | Package | Licence |',
  '| --- | --- | --- |',
  '| Lucide | lucide-react | ISC |',
  '',
);

writeFileSync('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}`);
process.stdout.write(`listed ${packages.size} packages\n`);
