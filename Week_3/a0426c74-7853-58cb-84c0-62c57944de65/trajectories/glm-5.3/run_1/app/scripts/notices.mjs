// Writes THIRD_PARTY_NOTICES.md from the installed production dependency tree.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], { cwd: root, encoding: 'utf8' }));
const packages = [];
const seen = new Set();
const walk = (deps) => {
  for (const [name, info] of Object.entries(deps || {})) {
    const key = `${name}@${info.version}`;
    if (!info.version || seen.has(key)) continue;
    seen.add(key);
    packages.push({ name, version: info.version });
    walk(info.dependencies);
  }
};
walk(tree.dependencies);
packages.sort((a, b) => a.name.localeCompare(b.name));
const fontLicence = 'SIL Open Font License 1.1 (OFL-1.1)';
const licences = new Map();
for (const p of packages) {
  try {
    const meta = JSON.parse(execFileSync('npm', ['view', `${p.name}@${p.version}`, 'license', '--json'], { encoding: 'utf8' }));
    const value = Array.isArray(meta) ? meta[0] : meta;
    licences.set(p.name, typeof value === 'string' ? value : 'SEE PACKAGE LICENCE');
  } catch {
    licences.set(p.name, 'SEE PACKAGE LICENCE');
  }
}
const allowed = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);
const lines = [
  '# Third-party notices',
  '',
  'Licences are recorded per package from its published metadata. Shipped packages are the production dependency tree of `npm ls --omit=dev --all --json`.',
  '',
  ...packages.map((p) => `- ${p.name} ${p.version} — ${licences.get(p.name)}`),
  '',
  '## Bundled fonts',
  '',
  `- Funnel Display — ${fontLicence}`,
  `- Funnel Sans — ${fontLicence}`,
  '',
];
for (const p of packages) {
  if (!allowed.has(licences.get(p.name))) {
    console.error(`unreviewed licence for ${p.name}: ${licences.get(p.name)}`);
  }
}
writeFileSync(root + 'THIRD_PARTY_NOTICES.md', lines.join('\n') + '\n');
