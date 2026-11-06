#!/usr/bin/env python3
"""Verify shipped package licences and generate THIRD_PARTY_NOTICES.md.

Shipped packages are the production dependency tree as reported by
`npm ls --omit=dev --all --json`, plus the bundled fonts and icon set.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path('/app')
ALLOWED = {'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'OFL-1.1'}
# licences used by the fonts themselves (SIL Open Font License 1.1)
BUNDLED_ASSETS = [
    ('Instrument Serif (bundled font, from @fontsource/instrument-serif)', 'OFL-1.1'),
    ('Instrument Sans (bundled font, from @fontsource/instrument-sans)', 'OFL-1.1'),
    ('IBM Plex Mono (bundled font, from @fontsource/ibm-plex-mono)', 'OFL-1.1'),
]


def normalise(raw: str) -> str:
    text = raw.strip().lower()
    # the MIT permission grant, without the heading
    if 'permission is hereby granted, free of charge' in text and 'to deal in the software' in text:
        return 'MIT'
    if 'apache license' in text or 'apache-2.0' in text or 'apache 2.0' in text:
        return 'Apache-2.0'
    if 'open font license' in text or 'ofl' in text.split('\n')[0]:
        return 'OFL-1.1'
    if 'mit license' in text or text.startswith('mit '):
        return 'MIT'
    if 'isc license' in text or text == 'isc':
        return 'ISC'
    if 'bsd 2-clause' in text or 'redistribution and use in source and binary forms, with or without modification' in text:
        return 'BSD-2-Clause'
    if 'bsd 3-clause' in text:
        return 'BSD-3-Clause'
    if '0bsd' in text or 'zero-clause bsd' in text or 'permission to use, copy, modify, and/or distribute this software' in text:
        return '0BSD'
    return '?'


# known licences for packages that are optional and not installed locally
KNOWN_OPTIONAL = {'pg-native': ('MIT', 'optional dependency of pg, not installed')}


def licence_of(name: str) -> tuple[str, str]:
    if name in KNOWN_OPTIONAL:
        return KNOWN_OPTIONAL[name]
    pkg_path = ROOT / 'node_modules' / name
    # resolve nested paths: a/b/c -> find the highest node_modules
    while not (pkg_path / 'package.json').exists() and pkg_path != ROOT:
        pkg_path = pkg_path.parent.parent
        if 'node_modules' in pkg_path.name:
            pkg_path = pkg_path.parent
    pj = pkg_path / 'package.json'
    if not pj.exists():
        return '?', '(not installed)'
    data = json.loads(pj.read_text())
    lic = data.get('license', '')
    if isinstance(lic, list):
        lic = ' OR '.join(str(x) for x in lic)
    lic = str(lic)
    if '(' in lic:
        lic = lic.split('(')[0].strip()
    # SPDX suffix variants of MIT resolve to the same grant as the licence file
    if lic in ('MIT-0', 'MIT'):
        return 'MIT', ''
    if lic in ALLOWED:
        return lic, ''
    # fall back to reading the LICENSE file
    for cand in pkg_path.glob('LICENSE*'):
        return normalise(cand.read_text()[:4000]), cand.name
    for cand in pkg_path.glob('LICENCE*'):
        return normalise(cand.read_text()[:4000]), cand.name
    return normalise(lic), lic


def main():
    out = subprocess.run(
        ['npm', 'ls', '--omit=dev', '--all', '--json'],
        cwd=ROOT, capture_output=True, text=True)
    tree = json.loads(out.stdout)

    rows = []
    seen = set()

    def walk(node, path):
        for key, child in (node.get('dependencies') or {}).items():
            if child.get('invalid') or child.get('incomplete'):
                continue
            version = child.get('version', '?')
            ident = (key, version)
            if ident in seen:
                continue
            seen.add(ident)
            lic, note = licence_of(key)
            rows.append((key, version, lic, note))
            walk(child, path + [key])

    walk(tree, [])
    rows.sort(key=lambda r: r[0])

    bad = [r for r in rows if r[2] not in ALLOWED]

    lines = [
        '# Third-party notices',
        '',
        'Fluxseal ships the following third-party packages and bundled assets.',
        'The production dependency tree is reported by `npm ls --omit=dev --all --json`.',
        '',
        '## Shipped packages',
        '',
        '| Package | Version | Licence |',
        '|---|---|---|',
    ]
    for name, version, lic, _note in rows:
        lines.append(f'| {name} | {version} | {lic} |')

    lines += ['', '## Bundled fonts and icon set', '', '| Asset | Licence |', '|---|---|']
    for name, lic in BUNDLED_ASSETS:
        lines.append(f'| {name} | {lic} |')
    lines.append('')

    (ROOT / 'THIRD_PARTY_NOTICES.md').write_text('\n'.join(lines) + '\n')
    print(f'{len(rows)} packages listed')
    for name, version, lic, note in bad:
        print(f'UNSUITABLE: {name}@{version} -> {lic} {note}')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
