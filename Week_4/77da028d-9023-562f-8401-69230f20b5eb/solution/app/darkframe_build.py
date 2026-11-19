"""`build`: assembles dist/ from web/ - one stylesheet in filename order, the modules, fonts and vendored files,
each with a gzip sibling."""
import gzip
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WEB = ROOT / "web"
DIST = ROOT / "dist"
COMPRESSIBLE = {".js", ".css", ".svg", ".html"}


def compress(path: Path) -> None:
    path.with_name(path.name + ".gz").write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def main() -> None:
    shutil.rmtree(DIST, ignore_errors=True)
    assets = DIST / "assets"
    assets.mkdir(parents=True)
    shutil.copy(WEB / "index.html", DIST / "index.html")
    for source in sorted(WEB.rglob("*")):
        relative = source.relative_to(WEB)
        if source.is_dir() or relative.parts[0] == "css" or relative.name == "index.html" or source.name.startswith("LICENSE") \
                or source.suffix == ".txt":
            continue
        target = assets / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(source, target)
    (assets / "app.css").write_text("\n".join(path.read_text() for path in sorted((WEB / "css").glob("*.css"))))
    for path in [DIST / "index.html", *assets.rglob("*")]:
        if path.is_file() and path.suffix in COMPRESSIBLE:
            compress(path)


if __name__ == "__main__":
    main()
