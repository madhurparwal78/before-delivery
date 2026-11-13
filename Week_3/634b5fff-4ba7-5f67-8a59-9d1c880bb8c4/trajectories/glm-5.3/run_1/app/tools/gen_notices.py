#!/usr/bin/env python3
"""Regenerate THIRD_PARTY_NOTICES.md from the production dependency tree."""
import json
import subprocess
import os

tree = json.loads(subprocess.run(
    ['npm', 'ls', '--omit=dev', '--all', '--json'],
    capture_output=True, text=True, cwd=os.path.join(os.path.dirname(__file__), '..')).stdout)

seen: dict[str, None] = {}

def walk(deps):
    for name, info in (deps or {}).items():
        if not isinstance(info, dict):
            continue
        version = info.get('version')
        if version is None:
            continue  # an unmet optional dependency
        key = f'{name}@{version}'
        if key in seen:
            continue
        seen[key] = None
        walk(info.get('dependencies'))

walk(tree.get('dependencies', {}))

ALLOWED = {'MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD',
           '(MIT OR Apache-2.0)', 'Unlicense', 'WTFPL', '(MIT AND CC-BY-3.0)'}

rows = []
bad = []
for spec in sorted(seen):
    name = spec.rsplit('@', 1)[0] if spec.startswith('@') else spec.split('@')[0]
    pkg = os.path.join('node_modules', name, 'package.json')
    licence = '(missing)'
    if os.path.exists(pkg):
        with open(pkg) as fh:
            meta = json.load(fh)
        licence = meta.get('license')
        if isinstance(licence, dict):
            licence = licence.get('type')
        if licence is None and isinstance(meta.get('licenses'), list) and meta['licenses']:
            licence = meta['licenses'][0].get('type')
        licence = licence or '(missing)'
    rows.append((spec, licence))
    if licence not in ALLOWED:
        bad.append((spec, licence))

lines = [
    '# Third-party notices',
    '',
    'Every shipped package (the production dependency tree of `npm ls --omit=dev --all --json`)',
    'and its licence:',
    '',
]
for spec, licence in rows:
    lines.append(f'- {spec} — {licence}')
lines += [
    '',
    '## Fonts (bundled with the app)',
    '- Gloock — SIL Open Font License 1.1 (Google Fonts, OFL)',
    '- Newsreader (regular and italic variable) — SIL Open Font License 1.1 (Google Fonts, OFL)',
    '',
    '## Media',
    '- Tale text: "The Little Match-Seller" by Hans Christian Andersen, translated by',
    '  H. P. Paull (1872). Public domain.',
    '- Narration files `public/narration/<chapter>.ogg` (one per chapter) were generated',
    '  offline by `tools/gen_narration.py` from sine partials and shaped noise; no external',
    '  recordings were used. Public domain by construction.',
    '- All geometry, textures and artwork in the client are generated procedurally at run',
    '  time or drawn in CSS/SVG within the app. Public domain by construction.',
    '',
]

with open('THIRD_PARTY_NOTICES.md', 'w') as fh:
    fh.write('\n'.join(lines))

print(f'{len(rows)} shipped packages listed')
if bad:
    print('NON-CONFORMING:', bad)
    raise SystemExit(1)
print('all licences conform')
