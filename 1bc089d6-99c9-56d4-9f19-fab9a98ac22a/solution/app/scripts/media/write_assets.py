"""Regenerate assets.json: every binary file under public/ and src/ with its sha256, how it was made and its licence.

Run from the app root:  python3 scripts/media/write_assets.py
"""
import hashlib
import json
from pathlib import Path

BINARY = {".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".svg", ".ico", ".mp3", ".ogg", ".wav", ".m4a",
          ".mp4", ".webm", ".woff", ".woff2", ".ttf", ".otf", ".glb", ".gltf", ".bin"}


FONTS = {"fraunces": "Fraunces (github.com/undercasetype/Fraunces), latin subsets from @fontsource-variable/fraunces 5.3.0",
         "hanken-grotesk": "Hanken Grotesk (github.com/marcologous/hanken-grotesk), latin subsets from @fontsource-variable/hanken-grotesk 5.3.0"}


def source(path: Path) -> str:
    name = path.name
    if path.parent.name == "fonts":
        return next(origin for family, origin in FONTS.items() if name.startswith(family))
    if path.parent.name == "fallback":
        return "hand-drawn SVG for this app: the flat scene shown without WebGL, in the scenes' colours"
    if name == "lantern-out.svg":
        return "hand-drawn SVG for this app: the lantern with its flame out"
    if path.parent.name == "audio":
        return "scripts/media/synth_audio.py (synthesised from sine waves and filtered noise)"
    if name.startswith("ritual-") or name.startswith("one-still-hour") or name == "film-poster.webp":
        return "scripts/media/render_media.py (rendered from scripts/media/harness.html shaders)"
    if name in {"favicon.svg", "favicon-32.png", "touch-icon.png", "share-card.png"}:
        return "scripts/media/brand.py (drawn from the Stillhour mark)"
    raise SystemExit(f"no known source for {path}")


def main():
    rows = []
    for path in sorted(p for root in ("public", "src") for p in Path(root).rglob("*")):
        if path.is_file() and path.suffix.lower() in BINARY:
            rows.append({"path": path.as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "source": source(path), "licence": "OFL-1.1" if path.parent.name == "fonts" else "original"})
    Path("assets.json").write_text(json.dumps(rows, indent=2) + "\n")
    print(f"assets.json: {len(rows)} files")


if __name__ == "__main__":
    main()
