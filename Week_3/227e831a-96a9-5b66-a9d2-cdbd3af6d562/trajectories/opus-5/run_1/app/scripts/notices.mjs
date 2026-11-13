import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { encoding: 'utf8' }),
);

const found = new Map();
const walk = (dependencies) => {
  for (const [name, info] of Object.entries(dependencies ?? {})) {
    if (info.version === undefined) continue;
    found.set(`${name}@${info.version}`, { name, version: info.version });
    walk(info.dependencies);
  }
};
walk(tree.dependencies);

const licenceOf = (name) => {
  const path = `node_modules/${name}/package.json`;
  if (!existsSync(path)) return 'unknown';
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  return typeof manifest.license === 'string' ? manifest.license : 'unknown';
};

const fonts = [
  ['Space Grotesk', '@fontsource/space-grotesk 5.1.1', 'SIL OFL 1.1'],
  ['IBM Plex Sans', '@fontsource/ibm-plex-sans 5.1.1', 'SIL OFL 1.1'],
  ['IBM Plex Mono', '@fontsource/ibm-plex-mono 5.1.1', 'SIL OFL 1.1'],
];

const rows = [...found.values()]
  .sort((a, b) => (a.name < b.name ? -1 : 1))
  .map((entry) => `| ${entry.name} | ${entry.version} | ${licenceOf(entry.name)} |`)
  .join('\n');

writeFileSync(
  'THIRD_PARTY_NOTICES.md',
  `# Third-party notices

Skinout ships the packages and fonts below. The package list is the production
dependency tree reported by \`npm ls --omit=dev --all --json\`.

## Shipped packages

| Package | Version | Licence |
| --- | --- | --- |
${rows}

## Bundled fonts

| Font | Source package | Licence |
| --- | --- | --- |
${fonts.map(([font, source, licence]) => `| ${font} | ${source} | ${licence} |`).join('\n')}

The font files in \`dist/public/fonts\` are copied from those packages at build
time and served by the app itself.
`,
);
console.log('notices written');
