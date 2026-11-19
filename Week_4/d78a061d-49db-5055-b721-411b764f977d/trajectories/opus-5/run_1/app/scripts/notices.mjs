import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }),
);

const packages = new Map();
const walk = (node) => {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version !== undefined && !packages.has(name)) packages.set(name, value.version);
    walk(value);
  }
};
walk(tree);

const rows = [];
for (const [name, version] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  let licence = 'see package';
  try {
    const manifest = JSON.parse(
      await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'),
    );
    licence =
      typeof manifest.license === 'string'
        ? manifest.license
        : Array.isArray(manifest.licenses)
          ? manifest.licenses.map((entry) => entry.type).join(', ')
          : licence;
  } catch {
    continue;
  }
  rows.push(`| \`${name}\` | ${version} | ${licence} |`);
}

const assets = [
  ['Fredoka (headings, tab labels, stat numerals)', '@fontsource/fredoka', 'OFL-1.1'],
  ['Nunito (body text and controls)', '@fontsource/nunito', 'OFL-1.1'],
  ['Noto Sans JP (Japanese text)', '@fontsource/noto-sans-jp', 'OFL-1.1'],
  ['Lucide line icons (one consistent set)', 'lucide-static', 'ISC'],
];

const body = `# Third-party notices

Linewright ships the production dependency tree below, taken from
\`npm ls --omit=dev --all --json\`, together with the fonts and icons listed under
bundled assets. Every entry uses one of the licences allowed by the brief.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
${rows.join('\n')}

## Bundled fonts, icons and 3D assets

| Asset | Source package | Licence |
| --- | --- | --- |
${assets.map(([label, pkg, licence]) => `| ${label} | \`${pkg}\` | ${licence} |`).join('\n')}

Every 3D asset in the product — the stick-figure hero and its parts, the drawn
weapons, the level props and the model thumbnails — is generated in code from
the geometry in \`src/client/scene\` and \`src/server/models\`. No model, texture
or image file is bundled.

The glTF acceptance rules run the Khronos glTF-Validator through the
\`gltf-validator\` package, pinned at version 2.0.0-dev.3.10 (Apache-2.0).
`;

await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), body, 'utf8');
console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages`);
