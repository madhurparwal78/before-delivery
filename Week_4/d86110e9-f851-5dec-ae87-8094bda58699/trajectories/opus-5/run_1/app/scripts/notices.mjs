import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root }).toString());
const packages = new Map();

function walk(node) {
  for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
    if (entry.version === undefined) continue;
    if (!packages.has(name)) {
      let licence = 'see package';
      try {
        licence = JSON.parse(readFileSync(`${root}node_modules/${name}/package.json`, 'utf8')).license ?? licence;
      } catch {}
      packages.set(name, { version: entry.version, licence });
    }
    walk(entry);
  }
}
walk(tree);

const fonts = readdirSync(`${root}public/assets/fonts`).sort();
const fontLicence = 'SIL OFL 1.1';

const lines = [
  '# Third party notices',
  '',
  'Pinbyte Switchyard ships the packages and font files listed here.',
  '',
  '## Shipped packages',
  '',
  'The production dependency tree from `npm ls --omit=dev --all --json`.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...[...packages.entries()].sort().map(([name, info]) => `| ${name} | ${info.version} | ${info.licence} |`),
  '',
  '## Bundled font files',
  '',
  'Served from `/assets/fonts/`, copied at build time from the `@fontsource` packages.',
  '',
  '| File | Family | Licence |',
  '| --- | --- | --- |',
  ...fonts.map((file) => {
    const family = file.startsWith('bricolage')
      ? 'Bricolage Grotesque'
      : file.startsWith('schibsted')
        ? 'Schibsted Grotesk'
        : 'JetBrains Mono';
    return `| ${file} | ${family} | ${fontLicence} |`;
  }),
  '',
];

writeFileSync(`${root}THIRD_PARTY_NOTICES.md`, `${lines.join('\n')}`);
process.stdout.write(`listed ${packages.size} packages and ${fonts.length} font files\n`);
