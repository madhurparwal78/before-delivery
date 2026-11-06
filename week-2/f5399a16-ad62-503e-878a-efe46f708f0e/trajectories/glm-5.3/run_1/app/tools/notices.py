"""Builds THIRD_PARTY_NOTICES.md from the installed production dependency
tree (`npm ls --omit=dev --all --json`), as IF-02 requires."""
import json
import subprocess
import os

ALLOWED = {"MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "Unlicense", "OFL-1.1"}

tree = json.loads(subprocess.check_output(["npm", "ls", "--omit=dev", "--all", "--json"], text=True))

packages = {}


def walk(node):
    for name, info in node.get("dependencies", {}).items():
        if name in packages:
            continue
        packages[name] = info
        walk(info)


walk(tree)

lines = ["# Third-party notices", "",
         "Every shipped package (the production dependency tree of `npm ls --omit=dev --all --json`)",
         "and both shipped fonts, with its licence.", ""]

bad = []
for name in sorted(packages):
    pkg_path = os.path.join("node_modules", name, "package.json")
    licence = "unknown"
    version = ""
    if os.path.exists(pkg_path):
        with open(pkg_path) as fh:
            pkg = json.load(fh)
        licence = pkg.get("license") or "unknown"
        version = pkg.get("version") or ""
        if licence not in ALLOWED:
            bad.append((name, licence))
    lines.append(f"- {name} {version} — {licence}")

lines += ["", "## Fonts", "",
          "- Libre Franklin (static instances 400 and 700, subset WOFF2) — OFL-1.1",
          "- Source Serif 4 (static instances 400, 600 and 700, subset WOFF2) — OFL-1.1", ""]

if bad:
    raise SystemExit(f"licences outside the allowed set: {bad}")

with open("THIRD_PARTY_NOTICES.md", "w") as fh:
    fh.write("\n".join(lines))

print(f"{len(packages)} packages, all licences allowed")
