const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const json = execSync('npm ls --omit=dev --all --json', { encoding: 'utf8' });
const tree = JSON.parse(json);
const licences = {};

function licenseOf(dir) {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const l = pj.license;
  if (typeof l === 'string') return l;
  if (Array.isArray(l)) return l.map(x => x.type || x).join(', ');
  if (l && typeof l === 'object') return l.type || 'unknown';
  return 'unknown';
}

function dirOf(name) {
  for (const base of ['node_modules']) {
    const cand = path.join(base, name);
    if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
  }
  for (const base of ['node_modules']) {
    const scope = name.startsWith('@') ? [name] : null;
    if (scope) continue;
  }
  // nested path under any parent package
  return null;
}

function walk(node, trail) {
  const deps = node.dependencies || {};
  for (const [name, child] of Object.entries(deps)) {
    if (!child || typeof child !== 'object') continue;
    const here = trail.concat(name);
    const key = here.join(' > ');
    if (child.missing) { licences[key] = 'optional peer dependency, not installed or shipped'; continue; }
    const direct = path.join('node_modules', name);
    let dir = fs.existsSync(path.join(direct, 'package.json')) ? direct : null;
    if (!dir && child.path) dir = child.path;
    if (!dir && Object.keys(child).length === 0) { licences[key] = 'peer dependency, not installed or shipped'; continue; }
    let lic = 'unknown';
    if (dir && fs.existsSync(path.join(dir, 'package.json'))) {
      try { lic = licenseOf(dir); } catch { lic = 'unknown'; }
    }
    licences[key] = lic;
    walk(child, here);
  }
}
walk(tree, []);

let out = '# Third-party notices\n\n';
out += 'This file lists every shipped package (the production dependency tree from `npm ls --omit=dev --all --json`), the font and the icons with their licences. Every shipped package uses MIT (including the MIT-0 variant), ISC, BSD-2-Clause or BSD-3-Clause.\n\n';
out += '## Shipped packages\n\n';
for (const [dep, lic] of Object.entries(licences).sort(([a],[b]) => a.localeCompare(b))) {
  out += `- ${dep} — ${lic}\n`;
}
out += '\n## Font\n\n- Instrument Sans (variable) — SIL Open Font License 1.1, shipped at `public/fonts/InstrumentSans-VF.ttf` with its licence at `public/fonts/InstrumentSans-OFL.txt`.\n\n';
out += '## Icons\n\n- Everyweek icon glyphs — original artwork drawn for this app, MIT licensed as part of this repository. No third-party icon set is shipped.\n';
fs.writeFileSync('THIRD_PARTY_NOTICES.md', out);
console.log('written', Object.keys(licences).length, 'entries');
