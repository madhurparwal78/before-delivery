/**
 * Regenerates THIRD_PARTY_NOTICES.md from the production dependency tree
 * (`npm ls --omit=dev --all --json`), plus the fonts and the icon set the build vendors.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);

interface DependencyNode {
  readonly version?: string;
  readonly dependencies?: Readonly<Record<string, DependencyNode>>;
}

const tree = JSON.parse(
  execSync('npm ls --omit=dev --all --json', { maxBuffer: 1e9 }).toString(),
) as DependencyNode;

const packages = new Map<string, string>();
(function walk(node: DependencyNode): void {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version !== undefined) packages.set(`${name}@${value.version}`, name);
    walk(value);
  }
})(tree);

interface PackageManifest {
  readonly license?: string | { readonly type?: string };
}

const rows: Array<{ name: string; version: string; licence: string }> = [];
const offenders: string[] = [];
for (const key of [...packages.keys()].sort()) {
  const name = packages.get(key) as string;
  const manifest = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')) as PackageManifest;
  const licence =
    typeof manifest.license === 'string' ? manifest.license : (manifest.license?.type ?? 'UNKNOWN');
  const version = key.slice(name.length + 1);
  rows.push({ name, version, licence });
  if (!ALLOWED.has(licence)) offenders.push(`${key} is ${licence}`);
}

if (offenders.length > 0) {
  process.stderr.write(`Shipped packages with a disallowed licence:\n  ${offenders.join('\n  ')}\n`);
  process.exit(1);
}

const FONTS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['IBM Plex Sans', 'OFL-1.1', 'IBM', '@fontsource/ibm-plex-sans'],
  ['IBM Plex Mono', 'OFL-1.1', 'IBM', '@fontsource/ibm-plex-mono'],
  ['Instrument Serif', 'OFL-1.1', 'Rodrigo Fuenzalida and Natanael Gama', '@fontsource/instrument-serif'],
];

const document = `# Third-party notices

Lanternfold Rooms ships the packages, fonts and icons listed here. Shipped packages are the
production dependency tree reported by \`npm ls --omit=dev --all --json\`.

Regenerate this file with \`node scripts/notices.mjs\`.

## Packages

| Package | Version | Licence |
| --- | --- | --- |
${rows.map((row) => `| ${row.name} | ${row.version} | ${row.licence} |`).join('\n')}

${rows.length} package${rows.length === 1 ? '' : 's'} in total.

## Fonts

The font files are vendored into the build from the packages named below, which are build-time
dependencies and are not part of the production dependency tree. Both the web fonts the browser
loads and the TrueType faces embedded in the recap PDF come from these families.

| Font | Licence | Author | Source package |
| --- | --- | --- | --- |
${FONTS.map(([font, licence, author, pkg]) => `| ${font} | ${licence} | ${author} | \`${pkg}\` |`).join('\n')}

## Icons

| Icon set | Licence | Source package |
| --- | --- | --- |
| Lucide | ISC | \`lucide-static\` |

Lucide is a community fork of Feather Icons, © 2013–2022 Cole Bemis and © 2022 Lucide
Contributors, used under the ISC licence.
`;

writeFileSync('THIRD_PARTY_NOTICES.md', document, 'utf8');
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages, ${FONTS.length} fonts and the Lucide icon set\n`);
