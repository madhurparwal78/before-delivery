"""Ship subsetted WOFF2 builds of Libre Franklin and Source Serif 4.

One build per face, with the Latin + Latin-Ext glyph set the app's copy uses,
as static instances of the weights the design names (400 and 700), so a
browser renders the same shapes everywhere without loading another origin.
"""
import subprocess
import sys
from pathlib import Path

TMP = Path("/tmp/fonts")
FACES = {
    "libre-franklin": ("LibreFranklin.ttf", [400, 700]),
    "source-serif-4": ("SourceSerif4.ttf", [400, 600, 700]),
}
# Every code point that can appear in shipped copy: Latin, Latin-1 supplement,
# Latin Extended-A/B, punctuation, spaces, and the Arabic block for the
# mirrored private pages.
UNICODES = (
    "U+0000-00FF,U+0100-024F,U+0250-02FF,U+0300-036F,U+2000-206F,U+2070-209F,"
    "U+20A0-20CF,U+2100-214F,U+2190-2193,U+2500-257F,U+FB01-FB02,"
    "U+0590-05FF,U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF"
)


def main() -> int:
    out_root = Path("/app/assets/fonts")
    failures: list[str] = []
    for face, (src, weights) in FACES.items():
        src_path = TMP / src
        if not src_path.exists():
            failures.append(f"{src}: missing")
            continue
        for weight in weights:
            name = f"{face}-{weight}.woff2"
            out = out_root / face / name
            out.parent.mkdir(parents=True, exist_ok=True)
            cmd = [
                sys.executable, "-m", "fontTools.varLib.instancer",
                str(src_path), f"wght={weight}",
                "--output", str(TMP / f"{face}-{weight}.ttf"),
            ]
            inst = subprocess.run(cmd, capture_output=True, text=True)
            if inst.returncode != 0:
                failures.append(f"{name}: instancer failed: {inst.stderr[-300:]}")
                continue
            pyftsubset = [
                sys.executable, "-m", "fontTools.subset",
                str(TMP / f"{face}-{weight}.ttf"),
                f"--unicodes={UNICODES}",
                "--flavor=woff2",
                f"--output-file={out}",
                "--layout-features=kern,liga,ccmp,mark,mkmk",
                "--no-hinting",
            ]
            sub = subprocess.run(pyftsubset, capture_output=True, text=True)
            if sub.returncode != 0:
                failures.append(f"{name}: subset failed: {sub.stderr[-300:]}")
                continue
            print(f"{name}: {out.stat().st_size} bytes")
    for failure in failures:
        print(failure, file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
