#!/usr/bin/env python3
"""Write THIRD_PARTY_NOTICES.md from the production dependency tree."""
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request

ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def main():
    raw = subprocess.run(
        ["npm", "ls", "--omit=dev", "--all", "--json"],
        capture_output=True, text=True, check=False,
    ).stdout
    data = json.loads(raw)
    specs = set()

    def walk(node):
        for name, child in (node.get("dependencies") or {}).items():
            ver = child.get("version", "?")
            if ver != "?":
                specs.add((name, ver))
            walk(child)

    walk(data)

    rows = []
    for name, ver in sorted(specs):
        lic = "UNKNOWN"
        try:
            url = f"https://registry.npmjs.org/{urllib.parse.quote(name, safe='@/')}/{ver}"
            with urllib.request.urlopen(url, timeout=20) as r:
                meta = json.loads(r.read().decode())
            value = meta.get("license") or meta.get("licenses") or "UNKNOWN"
            if isinstance(value, dict):
                value = value.get("type", "UNKNOWN")
            if isinstance(value, list):
                value = " OR ".join(
                    x.get("type", "UNKNOWN") if isinstance(x, dict) else str(x) for x in value
                )
            lic = str(value)
        except Exception as e:
            print(f"warn: {name}@{ver}: {e}", file=sys.stderr)
        rows.append((name, ver, lic))
        time.sleep(0.03)

    bad = [(n, v, l) for n, v, l in rows if l not in ALLOWED]
    if bad:
        print("PACKAGES WITH UNEXPECTED LICENSES:", file=sys.stderr)
        for n, v, l in bad:
            print(f"  {n}@{v}: {l}", file=sys.stderr)

    lines = [
        "# Third-party notices",
        "",
        "This file lists every shipped package with its version and licence,",
        "plus the bundled Geist fonts. Shipped packages are the production",
        "dependency tree from `npm ls --omit=dev --all --json`.",
        "",
        "## Packages",
        "",
        "| Package | Version | Licence |",
        "|---|---|---|",
    ]
    for name, ver, lic in sorted(rows):
        lines.append(f"| {name} | {ver} | {lic} |")
    lines += [
        "",
        "## Fonts",
        "",
        "The Geist typeface is bundled as self-hosted web fonts.",
        "",
        "| Font | Version | Licence |",
        "|---|---|---|",
        "| Geist (Geist-Regular.woff2, Geist-SemiBold.woff2) | 1.9.2 | OFL-1.1 |",
        "",
    ]
    with open("/app/THIRD_PARTY_NOTICES.md", "w") as f:
        f.write("\n".join(lines))
    print(f"wrote {len(rows)} packages")


if __name__ == "__main__":
    main()
