"""Draw every image the app serves, as flat geometry in the icon family.

Run from /app: python3 tools/make_images.py
"""

from __future__ import annotations

import pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "northfall" / "static" / "img"

PAPER = "#faf7f1"
INK = "#17140f"
GREY = "#3a342c"
SOFT = "#e4ddce"
MID = "#c9c0ad"
LIME = "#d7ea8f"
BRICK = "#9b4a33"


def write(name: str, width: int, height: int, body: str) -> None:
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="presentation">'
        f'<rect width="{width}" height="{height}" fill="{PAPER}"/>'
        f"{body}</svg>"
    )
    (OUT / name).write_text(svg, encoding="utf-8")


def person(collar: str = LIME) -> str:
    return (
        f'<path d="M96 480 C96 380 160 332 240 332 C320 332 384 380 384 480 Z" fill="{GREY}"/>'
        f'<path d="M206 336 h68 v26 a34 34 0 0 1 -68 0 Z" fill="{collar}"/>'
        f'<circle cx="240" cy="236" r="78" fill="{GREY}"/>'
        f'<path d="M162 232 a78 78 0 0 1 156 0 l-12 -4 a66 66 0 0 0 -132 0 Z" fill="{INK}"/>'
    )


SCENES = {
    "portrait-aino-rask": (
        f'<g stroke="{MID}" stroke-width="10" fill="none">'
        f'<path d="M60 400 V150 H420 V400"/><path d="M40 150 H440"/>'
        f'<path d="M300 150 V250 H340"/></g>'
        f'<rect x="286" y="246" width="60" height="44" fill="{SOFT}"/>'
    ),
    "portrait-mikael-soderholm": (
        "".join(
            f'<rect x="{x}" y="236" width="42" height="130" rx="18" fill="{SOFT}"/>'
            f'<rect x="{x + 13}" y="214" width="16" height="30" fill="{MID}"/>'
            for x in (56, 126, 300, 370)
        )
        + f'<rect x="40" y="366" width="400" height="14" fill="{MID}"/>'
    ),
    "portrait-leena-varjo": (
        f'<circle cx="120" cy="250" r="88" fill="{SOFT}"/>'
        f'<circle cx="120" cy="250" r="44" fill="{MID}"/>'
        f'<rect x="320" y="150" width="110" height="230" fill="{SOFT}"/>'
        f'<rect x="340" y="176" width="70" height="18" fill="{MID}"/>'
        f'<rect x="340" y="210" width="70" height="18" fill="{MID}"/>'
    ),
    "portrait-tomas-brandt": (
        f'<g stroke="{MID}" stroke-width="10" fill="none">'
        f'<path d="M30 460 L200 160"/><path d="M450 460 L280 160"/>'
        f'<path d="M110 330 H370"/><path d="M70 410 H410"/></g>'
        f'<rect x="384" y="150" width="16" height="150" fill="{MID}"/>'
        f'<circle cx="392" cy="150" r="26" fill="{BRICK}"/>'
    ),
    "portrait-iiris-kallio": (
        f'<path d="M20 420 L300 190 L360 190 L80 420 Z" fill="{SOFT}"/>'
        f'<rect x="330" y="120" width="120" height="300" fill="{MID}"/>'
        f'<rect x="356" y="152" width="68" height="60" fill="{SOFT}"/>'
    ),
    "portrait-joonas-hirvi": (
        "".join(
            f'<rect x="40" y="{y}" width="400" height="52" fill="{SOFT}"/>'
            f'<rect x="60" y="{y + 18}" width="34" height="16" fill="{MID}"/>'
            for y in (130, 200, 270, 340)
        )
    ),
}

STORY = {
    "story-2014": (
        f'<rect x="0" y="470" width="1200" height="205" fill="{SOFT}"/>'
        f'<rect x="150" y="250" width="420" height="260" rx="8" fill="{PAPER}" stroke="{MID}" stroke-width="8"/>'
        f'<path d="M360 250 V510" stroke="{MID}" stroke-width="8"/>'
        f'<g fill="{MID}">'
        f'<rect x="760" y="300" width="300" height="200" rx="6" transform="rotate(6 910 400)"/>'
        f'<rect x="780" y="286" width="300" height="200" rx="6" transform="rotate(-4 930 386)" fill="{PAPER}" stroke="{MID}" stroke-width="6"/>'
        f"</g>"
        f'<rect x="470" y="330" width="240" height="150" rx="4" fill="{PAPER}" stroke="{INK}" stroke-width="6"/>'
        f'<g fill="{INK}"><rect x="500" y="364" width="120" height="16"/>'
        f'<rect x="500" y="398" width="180" height="10"/><rect x="500" y="424" width="150" height="10"/></g>'
        f'<rect x="470" y="330" width="240" height="18" fill="{LIME}"/>'
    ),
    "story-2017": (
        f'<rect x="0" y="430" width="1200" height="245" fill="{SOFT}"/>'
        f'<rect x="380" y="230" width="440" height="280" rx="6" fill="{PAPER}" stroke="{INK}" stroke-width="6"/>'
        f'<g fill="{INK}"><rect x="420" y="268" width="200" height="18"/>'
        f'<rect x="420" y="320" width="360" height="10"/><rect x="420" y="348" width="330" height="10"/></g>'
        f'<rect x="420" y="394" width="120" height="44" fill="{LIME}"/>'
        f'<rect x="580" y="394" width="120" height="44" fill="{LIME}"/>'
        f'<path d="M120 500 C210 470 260 440 340 430 l0 50 C270 492 220 520 150 540 Z" fill="{GREY}"/>'
        f'<path d="M1080 500 C990 470 940 440 860 430 l0 50 C930 492 980 520 1050 540 Z" fill="{GREY}"/>'
        f'<path d="M880 250 L1000 150" stroke="{INK}" stroke-width="14" stroke-linecap="round"/>'
    ),
    "story-2020": (
        "".join(
            f'<rect x="420" y="{y}" width="360" height="86" rx="6" fill="{PAPER}" stroke="{MID}" stroke-width="6"/>'
            f'<rect x="450" y="{y + 30}" width="40" height="26" fill="{INK}"/>'
            f'<rect x="520" y="{y + 34}" width="200" height="14" fill="{MID}"/>'
            for y in (300, 400, 500)
        )
        + f'<rect x="420" y="200" width="360" height="86" rx="6" fill="{PAPER}" stroke="{MID}" stroke-width="6"/>'
        f'<rect x="450" y="230" width="40" height="26" fill="{INK}"/>'
        f'<rect x="520" y="234" width="200" height="14" fill="{MID}"/>'
        f'<rect x="830" y="80" width="300" height="86" rx="6" fill="{LIME}" stroke="{INK}" stroke-width="6" transform="rotate(-8 980 123)"/>'
        f'<path d="M800 240 L860 160" stroke="{INK}" stroke-width="10" stroke-linecap="round"/>'
        f'<path d="M400 600 h400" stroke="{MID}" stroke-width="6" stroke-dasharray="18 14"/>'
    ),
    "story-2023": (
        f'<rect x="90" y="120" width="480" height="440" rx="6" fill="{PAPER}" stroke="{INK}" stroke-width="6"/>'
        f'<rect x="630" y="120" width="480" height="440" rx="6" fill="{PAPER}" stroke="{INK}" stroke-width="6"/>'
        f'<g fill="{INK}"><rect x="140" y="170" width="260" height="22"/>'
        f'<rect x="680" y="170" width="300" height="22"/></g>'
        + "".join(
            f'<rect x="140" y="{y}" width="380" height="12" fill="{MID}"/>'
            f'<rect x="680" y="{y}" width="380" height="12" fill="{MID}"/>'
            for y in (240, 274, 308, 342, 376, 410, 444)
        )
        + f'<rect x="585" y="100" width="30" height="500" fill="{LIME}"/>'
        f'<path d="M585 600 l15 -26 l15 26 Z" fill="{LIME}"/>'
    ),
}


def texture() -> str:
    lines = "".join(
        f'<path d="M{-600 + step} 600 L{step} 0" stroke="{MID}" stroke-width="1.5" opacity="0.5"/>'
        for step in range(0, 1900, 26)
    )
    dots = "".join(
        f'<circle cx="{x}" cy="{y}" r="2" fill="{MID}" opacity="0.45"/>'
        for y in range(18, 600, 48)
        for x in range(18, 1200, 48)
    )
    return lines + dots


def social() -> str:
    return (
        f'<rect x="0" y="0" width="1200" height="18" fill="{LIME}"/>'
        f'<text x="80" y="200" font-family="Georgia, serif" font-size="58" fill="{INK}">Northfall</text>'
        f'<text x="80" y="330" font-family="Georgia, serif" font-size="76" fill="{INK}">References you can check,</text>'
        f'<text x="80" y="420" font-family="Georgia, serif" font-size="76" fill="{INK}">from installations we</text>'
        f'<text x="80" y="510" font-family="Georgia, serif" font-size="76" fill="{INK}">actually finished</text>'
        f'<rect x="80" y="545" width="420" height="16" fill="{LIME}"/>'
        f'<text x="80" y="600" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="{GREY}">'
        "Every story is published with the customer&#8217;s written agreement</text>"
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, scene in SCENES.items():
        write(f"{name}.svg", 480, 480, scene + person())
    for name, scene in STORY.items():
        write(f"{name}.svg", 1200, 675, scene)
    write("texture-promise.svg", 1200, 600, texture())
    write("social-preview.svg", 1200, 630, social())
    for path in sorted(OUT.iterdir()):
        print(path.name, path.stat().st_size)


if __name__ == "__main__":
    main()
