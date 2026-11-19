"""`build`: copies the browser sources and vendored assets into `static`."""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
VENDOR = ROOT / "vendor"
BUILT = ROOT / "static"

VENDOR_FILES = {
    "three.module.min.js": "three.module.js",
    "sora-latin.woff2": "sora-latin.woff2",
    "sora-latin-ext.woff2": "sora-latin-ext.woff2",
}


def main() -> None:
    if BUILT.exists():
        shutil.rmtree(BUILT)
    shutil.copytree(WEB, BUILT)
    vendor_out = BUILT / "vendor"
    vendor_out.mkdir(parents=True, exist_ok=True)
    for source, name in VENDOR_FILES.items():
        shutil.copyfile(VENDOR / source, vendor_out / name)
    print(f"built {sum(1 for _ in BUILT.rglob('*') if _.is_file())} files")


if __name__ == "__main__":
    main()
