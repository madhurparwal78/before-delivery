import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 }),
);

const collect = (node, into) => {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version !== undefined && !into.has(name)) into.set(name, value.version);
    collect(value, into);
  }
  return into;
};
const packages = collect(tree, new Map());
const everything = collect(
  JSON.parse(execFileSync('npm', ['ls', '--all', '--json'], { encoding: 'utf8', maxBuffer: 1 << 26 })),
  new Map(),
);
const buildOnly = [...everything].filter(([name]) => !packages.has(name));

/** The first copyright line of the package's licence file, or its author. */
async function copyrightLine(name) {
  const dir = join(root, 'node_modules', name);
  const files = (await readdir(dir)).filter((file) => /^(licen[cs]e|copying)/i.test(file));
  for (const file of files) {
    const line = (await readFile(join(dir, file), 'utf8'))
      .split('\n')
      .find((text) => /copyright/i.test(text) && /\d{4}|\(c\)|©/i.test(text));
    if (line !== undefined) return line.trim().replace(/\|/g, '/');
  }
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  return author ? `Copyright ${author}` : `Copyright the ${name} authors`;
}

async function tableRows(list) {
  const rows = [];
  for (const [name, version] of [...list].sort(([a], [b]) => a.localeCompare(b))) {
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
    rows.push(`| \`${name}\` | ${version} | ${licence} | ${await copyrightLine(name)} |`);
  }
  return rows;
}
const rows = await tableRows(packages);
const buildRows = await tableRows(buildOnly);

const assets = [
  ['Fredoka 400 and 600, latin (`assets/fonts/fredoka-*.woff2`)', 'Fontsource `@fontsource/fredoka` 5.3.0; Copyright 2016 The Fredoka Project Authors', 'OFL-1.1'],
  ['Nunito 400 and 700, latin (`assets/fonts/nunito-*.woff2`)', 'Fontsource `@fontsource/nunito` 5.3.0; Copyright 2014 The Nunito Project Authors', 'OFL-1.1'],
  ['Noto Sans JP 400 and 700, japanese (`assets/fonts/noto-sans-jp-*.woff2`)', 'Fontsource `@fontsource/noto-sans-jp` 5.3.1; Copyright Google Inc.', 'OFL-1.1'],
  ['Lucide line icons, one consistent set (inline SVG sprite built from `lucide-static`)', '`lucide-static` 1.66.0; Copyright Lucide Contributors', 'ISC'],
];
const licenceTexts = await Promise.all(
  ['OFL-fredoka.txt', 'OFL-nunito.txt', 'OFL-noto-sans-jp.txt'].map(async (file) => [
    file,
    await readFile(join(root, 'assets/licences', file), 'utf8'),
  ]),
);

const body = `# Third-party notices

Linewright ships the production dependency tree below, taken from
\`npm ls --omit=dev --all --json\`, together with the fonts and icons listed under
bundled assets. Every entry uses one of the licences allowed by the brief.

## Shipped packages

| Package | Version | Licence | Copyright |
| --- | --- | --- | --- |
${rows.join('\n')}

## Build-time packages (not shipped)

Used only by \`npm run build\` and type checking.

| Package | Version | Licence | Copyright |
| --- | --- | --- | --- |
${buildRows.join('\n')}

## Bundled fonts, icons and 3D assets

| Asset | Source and copyright | Licence |
| --- | --- | --- |
${assets.map(([label, source, licence]) => `| ${label} | ${source} | ${licence} |`).join('\n')}

Every 3D asset in the product — the stick-figure hero and its parts, the drawn
weapons, the level props and the model thumbnails — is generated in code from
the geometry in \`src/client/scene\` and \`src/server/models\`. No model, texture
or image file is bundled.

The glTF acceptance rules run the Khronos glTF-Validator through the
\`gltf-validator\` package, pinned at version 2.0.0-dev.3.10 (Apache-2.0).

## Font licence texts (SIL Open Font License 1.1)

${licenceTexts.map(([file, text]) => `### ${file}\n\n\`\`\`text\n${text.trim()}\n\`\`\``).join('\n\n')}
`;

await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), body, 'utf8');
console.log(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages`);
