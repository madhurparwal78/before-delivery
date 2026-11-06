"""Draw Stillhour's brand images from the mark (the same paths as src/story/components/Mark.tsx).

Run from the app root:  uv run --with playwright==1.49.1 python scripts/media/brand.py
Writes public/images/favicon.svg, favicon-32.png, touch-icon.png and share-card.png.
"""
from pathlib import Path

from playwright.sync_api import sync_playwright

IMAGES = Path("public/images")
FONTS = Path("public/fonts").resolve()
CRESCENT = "M30.34 18.50 A14.5 14.5 0 1 0 43.93 37.04 A11.5 11.5 0 0 1 30.34 18.50 Z"


def mark(stroke: float) -> str:
    return (f'<circle cx="32" cy="32" r="29" fill="none" stroke="#f4a259" stroke-width="{stroke}"/>'
            f'<path d="{CRESCENT}" fill="#f4a259"/>')


def favicon(stroke: float) -> str:
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            '<rect width="64" height="64" rx="15" fill="#0d0a1e"/>'
            f'<g transform="translate(6 6) scale(0.8125)">{mark(stroke)}</g></svg>')


SHARE = f"""<!doctype html><html><head><style>
@font-face {{ font-family: Fraunces; src: url({(FONTS / 'fraunces-latin-full-normal.woff2').as_uri()}); font-weight: 100 900; }}
@font-face {{ font-family: Hanken; src: url({(FONTS / 'hanken-grotesk-latin-wght-normal.woff2').as_uri()}); font-weight: 100 900; }}
html, body {{ margin: 0; }}
.card {{ width: 1200px; height: 630px; position: relative; overflow: hidden; color: #f3efe7;
  background: radial-gradient(ellipse 70% 55% at 78% 118%, rgba(244,162,89,0.55), rgba(244,162,89,0) 70%),
              linear-gradient(170deg, #3a2f66 0%, #231c44 42%, #0d0a1e 100%); }}
.grain {{ position: absolute; inset: 0; opacity: 0.045; background-image: repeating-linear-gradient(0deg, #fff 0 1px, transparent 1px 3px); }}
.horizon {{ position: absolute; left: 0; right: 0; bottom: 118px; height: 1px; background: linear-gradient(90deg, transparent, rgba(244,162,89,0.6), transparent); }}
svg {{ position: absolute; left: 104px; top: 168px; width: 210px; height: 210px; }}
h1 {{ position: absolute; left: 360px; top: 150px; margin: 0; font: 300 128px/1 Fraunces; letter-spacing: -0.02em; }}
p {{ position: absolute; left: 364px; top: 312px; margin: 0; font: 400 40px/1.3 Hanken; color: #d8d1e6; }}
.time {{ position: absolute; left: 364px; top: 430px; font: 500 28px Hanken; font-variant-numeric: tabular-nums; color: #f4a259; letter-spacing: 0.08em; }}
</style></head><body><div class="card"><div class="grain"></div><div class="horizon"></div>
<svg viewBox="0 0 64 64">{mark(1.6)}</svg>
<h1>Stillhour</h1><p>Give your last hour a shape.</p><div class="time">21:00 → 22:00</div></div></body></html>"""


def main():
    IMAGES.mkdir(parents=True, exist_ok=True)
    (IMAGES / "favicon.svg").write_text(favicon(3.6) + "\n")
    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=["--allow-file-access-from-files"])
        for name, size, stroke in (("favicon-32.png", 32, 4.6), ("touch-icon.png", 180, 3.4)):
            page = browser.new_page(viewport={"width": size, "height": size}, device_scale_factor=1)
            page.set_content(f'<html><body style="margin:0">{favicon(stroke).replace("<svg ", f"<svg width={size} height={size} ")}</body></html>')
            page.screenshot(path=str(IMAGES / name), omit_background=True)
            page.close()
        page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=1)
        source = Path("scripts/media/out/share-card.html")
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(SHARE)
        page.goto(source.resolve().as_uri())
        page.evaluate("() => document.fonts.ready")
        page.wait_for_timeout(200)
        page.screenshot(path=str(IMAGES / "share-card.png"))
        browser.close()


if __name__ == "__main__":
    main()
