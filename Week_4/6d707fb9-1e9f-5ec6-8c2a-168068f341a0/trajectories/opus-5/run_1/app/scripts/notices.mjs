import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root }).toString());

const found = new Map();
function walk(node) {
  for (const [name, held] of Object.entries(node.dependencies ?? {})) {
    if (held.version && !found.has(name)) {
      let licence = 'see package';
      try {
        const own = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
        licence = typeof own.license === 'string' ? own.license : licence;
      } catch {
        /* an optional dependency that is not installed */
      }
      found.set(name, { version: held.version, licence });
    }
    walk(held);
  }
}
walk(tree);

const fonts = [
  ['Sora', 'OFL-1.1', 'src/assets/fonts/OFL-Sora.txt'],
  ['Noto Sans', 'OFL-1.1', 'src/assets/fonts/OFL-Noto.txt'],
  ['Noto Sans Arabic', 'OFL-1.1', 'src/assets/fonts/OFL-Noto.txt'],
];

const lines = [
  '# Third-party notices',
  '',
  'Fio Contado Desk ships the packages and fonts below. Everything else in this',
  'repository is the product\u2019s own work, including all copy and all generated imagery.',
  '',
  '## Shipped packages',
  '',
  'The production dependency tree, as `npm ls --omit=dev --all` reports it.',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...[...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, held]) => `| ${name} | ${held.version} | ${held.licence} |`),
  '',
  '## Bundled fonts',
  '',
  'All three are bundled with the app and never loaded from another origin at runtime.',
  '',
  '| Font | Licence | Licence text |',
  '| --- | --- | --- |',
  ...fonts.map(([name, licence, path]) => `| ${name} | ${licence} | \`${path}\` |`),
  '',
];

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), `${lines.join('\n')}`);
process.stdout.write(`${found.size} packages listed\n`);
