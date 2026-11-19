import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ALLOWED = /^(MIT|MIT-0|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|ISC|BlueOak-1\.0\.0|Unlicense|OFL-1\.1|SIL Open Font License.*)$/;

const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }),
);

const packages = new Map();

function walk(node) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (!value || value.version === undefined) continue;
    const key = `${name}@${value.version}`;
    if (!packages.has(key)) {
      packages.set(key, { name, version: value.version, licence: licenceOf(name) });
      walk(value);
    }
  }
}

function licenceOf(name) {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'),
    );
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license?.type) return manifest.license.type;
    if (Array.isArray(manifest.licenses)) return manifest.licenses.map((item) => item.type).join(' OR ');
    return licenceFromFile(name);
  } catch {
    return 'UNKNOWN';
  }
}

/** Some older packages carry their licence only in a LICENSE file. */
function licenceFromFile(name) {
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENCE', 'license']) {
    try {
      const text = readFileSync(path.join(root, 'node_modules', name, file), 'utf8');
      if (/MIT License/i.test(text)) return 'MIT';
      if (/Apache License/i.test(text)) return 'Apache-2.0';
      if (/BSD/i.test(text)) return 'BSD-3-Clause';
      if (/ISC License/i.test(text)) return 'ISC';
    } catch {
      continue;
    }
  }
  return 'UNKNOWN';
}

walk(tree);

const fonts = [
  { name: 'Plus Jakarta Sans', version: '5.x (fontsource build)', licence: 'SIL Open Font License 1.1' },
  { name: 'DM Sans', version: '5.x (fontsource build)', licence: 'SIL Open Font License 1.1' },
];

const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name));
const offending = sorted.filter((entry) => !ALLOWED.test(entry.licence));

const lines = [
  '# Third party notices',
  '',
  'Roundbook ships the packages and fonts below. Every licence is permissive or an open font licence.',
  '',
  '## Shipped packages (production dependency tree)',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...sorted.map((entry) => `| ${entry.name} | ${entry.version} | ${entry.licence} |`),
  '',
  '## Bundled fonts',
  '',
  '| Font | Version | Licence |',
  '| --- | --- | --- |',
  ...fonts.map((font) => `| ${font.name} | ${font.version} | ${font.licence} |`),
  '',
];

writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'));
process.stdout.write(`${sorted.length} packages listed\n`);
if (offending.length > 0) {
  process.stdout.write(`unexpected licences: ${offending.map((entry) => `${entry.name} (${entry.licence})`).join(', ')}\n`);
  process.exit(1);
}
