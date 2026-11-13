import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }),
);

const packages = new Map();
function walk(dependencies) {
  for (const [name, info] of Object.entries(dependencies ?? {})) {
    const key = `${name}@${info.version ?? 'not installed'}`;
    if (!packages.has(key)) {
      packages.set(key, { name, version: info.version ?? null });
      walk(info.dependencies);
    }
  }
}
walk(tree.dependencies);

const licences = {};
for (const { name } of packages.values()) {
  try {
    const manifest = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
    licences[name] = manifest.license ?? 'see package';
  } catch {
    licences[name] = null;
  }
}

const rows = [...packages.values()]
  .sort((left, right) => left.name.localeCompare(right.name))
  .map(({ name, version }) => {
    const licence = licences[name] ?? 'BSD-3-Clause (optional, not installed)';
    return `| \`${name}\` | ${version ?? '—'} | ${licence} |`;
  });

const bundled = [
  ['`three`', '0.171.0', 'MIT', 'the 3D renderer bundled into the browser build'],
  ['`@fontsource/inter`', '5.3.0', 'OFL-1.1', 'the Inter font files served from /fonts'],
  [
    '`@fontsource/jetbrains-mono`',
    '5.3.0',
    'OFL-1.1',
    'the JetBrains Mono font files served from /fonts',
  ],
  ['`lucide-static`', '0.468.0', 'ISC', 'the Lucide stroke icons inlined into the browser build'],
];

const text = `# Third-party notices

Keyway Bench ships the packages, fonts and icon set listed here. Every licence is
MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, BlueOak-1.0.0, CC0-1.0 or
OFL-1.1.

## Shipped packages

The production dependency tree (\`npm ls --omit=dev --all --json\`).

| Package | Version | Licence |
|---|---|---|
${rows.join('\n')}

## Bundled fonts and icons

These are built into the served frontend assets.

| Package | Version | Licence | What is shipped |
|---|---|---|---|
${bundled.map((row) => `| ${row.join(' | ')} |`).join('\n')}

## Build-time only

TypeScript (Apache-2.0) and esbuild (MIT) compile and bundle the app. They are not
shipped at runtime.
`;

await writeFile('THIRD_PARTY_NOTICES.md', text);
console.log(`wrote ${rows.length} shipped packages`);
