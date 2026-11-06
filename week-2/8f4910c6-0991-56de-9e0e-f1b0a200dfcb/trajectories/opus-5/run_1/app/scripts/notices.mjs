import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'OFL-1.1',
]);

const FONTS = [
  { name: 'Fraunces', version: 'v38 (variable, latin subset)', licence: 'OFL-1.1', file: 'public/fonts/fraunces-variable-latin.woff2' },
  { name: 'Hanken Grotesk', version: 'v12 (variable, latin subset)', licence: 'OFL-1.1', file: 'public/fonts/hanken-grotesk-variable-latin.woff2' },
];

const tree = JSON.parse(execSync('npm ls --omit=dev --all --json', { cwd: root, maxBuffer: 1e8 }).toString());
const packages = new Map();

function licenceOf(name) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
    if (typeof manifest.license === 'string') return manifest.license;
    if (manifest.license?.type) return manifest.license.type;
    if (Array.isArray(manifest.licenses) && manifest.licenses[0]?.type) return manifest.licenses[0].type;
  } catch {
    // An optional dependency for another platform is not installed.
  }
  return null;
}

function walk(node) {
  for (const [name, value] of Object.entries(node.dependencies ?? {})) {
    if (value.version) {
      const licence = licenceOf(name);
      if (licence) packages.set(`${name}@${value.version}`, licence);
    }
    walk(value);
  }
}
walk(tree);

const rejected = [...packages].filter(([, licence]) => {
  const choices = licence.replace(/[()]/g, '').split(/\s+OR\s+/i).map((part) => part.trim());
  return !choices.some((choice) => ALLOWED.has(choice));
});
if (rejected.length > 0) {
  process.stderr.write(`licences outside the allow list: ${JSON.stringify(rejected)}\n`);
  process.exit(1);
}

const rows = [...packages]
  .sort(([a], [b]) => a.localeCompare(b))
  .map((entry) => {
    const at = entry[0].lastIndexOf('@');
    return `| ${entry[0].slice(0, at)} | ${entry[0].slice(at + 1)} | ${entry[1]} |`;
  });

const notices = [
  '# Third-party notices',
  '',
  'Rungboard ships the production dependency tree below, taken from',
  '`npm ls --omit=dev --all --json`, together with the two bundled fonts.',
  'Every licence named here is MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0,',
  '0BSD or OFL-1.1.',
  '',
  '## npm packages',
  '',
  '| Package | Version | Licence |',
  '| --- | --- | --- |',
  ...rows,
  '',
  '## Fonts',
  '',
  '| Font | Version | Licence | Bundled file |',
  '| --- | --- | --- | --- |',
  ...FONTS.map((font) => `| ${font.name} | ${font.version} | ${font.licence} | ${font.file} |`),
  '',
  'The full SIL Open Font Licence text of each font ships beside it:',
  '`public/fonts/OFL-Fraunces.txt` and `public/fonts/OFL-HankenGrotesk.txt`.',
  '',
].join('\n');

writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), notices);
process.stdout.write(`wrote THIRD_PARTY_NOTICES.md with ${rows.length} packages\n`);
