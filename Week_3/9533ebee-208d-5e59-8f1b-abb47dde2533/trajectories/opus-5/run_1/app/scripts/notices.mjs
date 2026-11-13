// Builds THIRD_PARTY_NOTICES.md from the production dependency tree and the
// bundled fonts, and checks every licence against the allowed list.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = dirname(import.meta.dirname);

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);

/** Every bundled font face, with the package it is taken from. */
const FONTS = [
  ['Space Grotesk', '@fontsource/space-grotesk'],
  ['IBM Plex Sans', '@fontsource/ibm-plex-sans'],
  ['IBM Plex Mono', '@fontsource/ibm-plex-mono'],
];

function walk(node, into) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined) continue;
    into.set(`${name}@${entry.version}`, { name, version: entry.version });
    walk(entry, into);
  }
  return into;
}

async function licenceOf(name) {
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
  );
  if (typeof manifest.license === 'string') return manifest.license;
  if (typeof manifest.license === 'object' && manifest.license !== null) {
    return String(manifest.license.type);
  }
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry.type).join(' OR ');
  }
  return 'UNKNOWN';
}

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const shipped = [...walk(tree, new Map()).values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const rows = [];
const problems = [];
for (const pkg of shipped) {
  const licence = await licenceOf(pkg.name);
  if (!ALLOWED.has(licence)) problems.push(`${pkg.name}@${pkg.version}: ${licence}`);
  rows.push([pkg.name, pkg.version, licence]);
}

const fontRows = [];
for (const [face, pkg] of FONTS) {
  const manifest = JSON.parse(
    await readFile(join(root, 'node_modules', pkg, 'package.json'), 'utf8'),
  );
  const licence = String(manifest.license);
  if (!ALLOWED.has(licence)) problems.push(`${face}: ${licence}`);
  fontRows.push([face, manifest.version, licence, pkg]);
}

const table = (header, body) =>
  [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...body].join('\n');

const document = `# Third-party notices

Quillmoor Reserve ships the packages and fonts below. Every one of them is
covered by one of MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD or
OFL-1.1.

## Shipped packages

These are the production dependency tree, as \`npm ls --omit=dev --all\` reports it.

${table(
  ['Package', 'Version', 'Licence'],
  rows.map(([name, version, licence]) => `| ${name} | ${version} | ${licence} |`),
)}

## Bundled fonts

The font files are served from the app's own origin, from \`dist/public/fonts\`.

${table(
  ['Font', 'Version', 'Licence', 'Package'],
  fontRows.map(
    ([face, version, licence, pkg]) => `| ${face} | ${version} | ${licence} | ${pkg} |`,
  ),
)}
`;

await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), document);

if (problems.length > 0) {
  process.stderr.write(`Licences outside the allowed list:\n${problems.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `THIRD_PARTY_NOTICES.md written: ${rows.length} packages, ${fontRows.length} fonts, all licences allowed\n`,
);
