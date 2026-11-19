"""The build step: compile the sources and check the static bundle is present.

It reaches no service and reads no credential.
"""

import compileall
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REQUIRED = (
    "static/index.html",
    "static/app.js",
    "static/styles.css",
    "static/fonts/IBMPlexSans-Regular.woff2",
)


def main():
    missing = [name for name in REQUIRED if not (ROOT / name).is_file()]
    if missing:
        print(f"missing shipped asset: {missing[0]}", file=sys.stderr)
        return 1
    ok = compileall.compile_dir(str(ROOT / "tailboard"), quiet=1, force=True)
    print("tailboard build ok", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
