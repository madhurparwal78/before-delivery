"""The four flat piece sets, drawn in the page. Original line work on a 45 unit grid."""
from __future__ import annotations

PIECE_NAMES = {
    "P": "Pawn",
    "N": "Knight",
    "B": "Bishop",
    "R": "Rook",
    "Q": "Queen",
    "K": "King",
}

BASE = '<path class="pc-body" d="M9.5 38.5h26v3.2h-26z" rx="1"/>'

CLASSIC = {
    "P": """
      <circle class="pc-body" cx="22.5" cy="13.5" r="5.4"/>
      <path class="pc-body" d="M17 32c0-6 3.2-7.6 3.8-11h3.4c.6 3.4 3.8 5 3.8 11z"/>
      <path class="pc-body" d="M13.5 32h18l1.8 6.5H11.7z"/>
      <path class="pc-body" d="M10 38.5h25v3.4H10z"/>
    """,
    "R": """
      <path class="pc-body" d="M11 8h4.6v3.6h4.4V8h5v3.6h4.4V8H34v9.5l-3.2 3v11l3.4 4.9H10.8l3.4-4.9v-11L11 17.5z"/>
      <path class="pc-body" d="M10 36.4h25v5.5H10z"/>
    """,
    "N": """
      <path class="pc-body" d="M13.2 36.6c0-8.6 3.4-13.6 8.4-17.5 2-1.6 2.6-3.1 1.9-5.3l-3.2 1.1-1.1-3.4 4.1-1.9 2.2-4.2c1 3.1 2.6 4.6 4.8 4.9 5.2.7 8.6 5.7 8.6 12.3 0 5.6-1.8 8.9-1.8 14z"/>
      <path class="pc-eye" d="M29.8 14.6a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>
      <path class="pc-line" d="M20.5 15.6l3.6-1.3"/>
      <path class="pc-body" d="M25.3 5.9l1.1-4.2 2.9 4.6z"/>
      <path class="pc-body" d="M9.8 36.4h27.4v5.5H9.8z"/>
    """,
    "B": """
      <path class="pc-body" d="M22.5 5.6c2.7 0 4.6 2 4.6 4.4 0 1.7-.9 2.9-2.2 3.9 3.5 2.4 5.9 5.6 5.9 9.1 0 4.3-3.7 7-8.3 7s-8.3-2.7-8.3-7c0-3.5 2.4-6.7 5.9-9.1-1.3-1-2.2-2.2-2.2-3.9 0-2.4 1.9-4.4 4.6-4.4z"/>
      <path class="pc-line" d="M22.5 15.4v7.8M18.8 19.3h7.4"/>
      <path class="pc-body" d="M14.5 30.5h16l1.8 5.9H12.7z"/>
      <path class="pc-body" d="M10 36.4h25v5.5H10z"/>
    """,
    "Q": """
      <path class="pc-body" d="M8.6 14.5l4.4 15.6h19l4.4-15.6-6.2 7.4-3.1-10.6-4.6 10.6-4.6-10.6-3.1 10.6z"/>
      <circle class="pc-body" cx="8.6" cy="12.6" r="2.4"/>
      <circle class="pc-body" cx="17" cy="9.2" r="2.4"/>
      <circle class="pc-body" cx="22.5" cy="7.4" r="2.6"/>
      <circle class="pc-body" cx="28" cy="9.2" r="2.4"/>
      <circle class="pc-body" cx="36.4" cy="12.6" r="2.4"/>
      <path class="pc-body" d="M12.6 30.1h19.8l1.8 6.3H10.8z"/>
      <path class="pc-body" d="M9.4 36.4h26.2v5.5H9.4z"/>
    """,
    "K": """
      <path class="pc-body" d="M21 3.4h3v3.4h3.4v3H24v3.6h-3V9.8h-3.4v-3H21z"/>
      <path class="pc-body" d="M22.5 13.8c5.6 0 10.2 3.9 10.2 8.8 0 3.4-2 5.9-4.4 8h-11.6c-2.4-2.1-4.4-4.6-4.4-8 0-4.9 4.6-8.8 10.2-8.8z"/>
      <path class="pc-body" d="M13.2 30.6h18.6l1.9 5.8H11.3z"/>
      <path class="pc-body" d="M9.4 36.4h26.2v5.5H9.4z"/>
    """,
}

STAUNTON = {
    "P": """
      <circle class="pc-solid" cx="22.5" cy="12.6" r="6"/>
      <path class="pc-solid" d="M16.4 20.4h12.2c-1.4 4.4-3 7.3-3 13.6h-6.2c0-6.3-1.6-9.2-3-13.6z"/>
      <path class="pc-solid" d="M11.6 34h21.8v4H11.6zM9.2 38h26.6v4H9.2z"/>
    """,
    "R": """
      <path class="pc-solid" d="M10.4 7.4h5.4v3.8h4.4V7.4h4.4v3.8h4.4V7.4h5.6v10.2l-3.4 2.6v10.4l3.4 3.6H10.4l3.4-3.6V20.2l-3.4-2.6z"/>
      <path class="pc-solid" d="M8.8 34h27.4v4H8.8zM7.6 38h29.8v4H7.6z"/>
    """,
    "N": """
      <path class="pc-solid" d="M12 34c0-9.4 4-14.6 9.4-18.6 1.6-1.2 2-2.4 1.4-4l-3.6 1.4-1.4-3.8 4.6-2.2 2.6-5c1.2 3.6 2.8 5.2 5.4 5.6C36 8.2 39 13.6 39 20.6c0 5.4-2 9-2 13.4z"/>
      <circle class="pc-hole" cx="31.4" cy="13.4" r="1.7"/>
      <path class="pc-solid" d="M9.6 34h27.8v4H9.6zM8.4 38h30.2v4H8.4z"/>
    """,
    "B": """
      <path class="pc-solid" d="M22.5 3.8c2.2 0 3.6 1.8 3.6 3.6 0 1.4-.8 2.4-1.8 3.2 4.4 3 7.4 6.8 7.4 11 0 4.6-4 7.4-9.2 7.4s-9.2-2.8-9.2-7.4c0-4.2 3-8 7.4-11-1-.8-1.8-1.8-1.8-3.2 0-1.8 1.4-3.6 3.6-3.6z"/>
      <path class="pc-hole" d="M21.4 13.8h2.2v9h-2.2z"/>
      <path class="pc-hole" d="M18 17.4h9v2.2h-9z"/>
      <path class="pc-solid" d="M11.4 30h22.2v4H11.4zM9.2 34h26.6v4H9.2zM7.8 38h29.4v4H7.8z"/>
    """,
    "Q": """
      <path class="pc-solid" d="M7 11l5 19h21l5-19-7 8-3.4-12-4.6 12-4.6-12L16 19z"/>
      <circle class="pc-solid" cx="7" cy="9.4" r="3"/>
      <circle class="pc-solid" cx="16" cy="6.2" r="2.8"/>
      <circle class="pc-solid" cx="22.5" cy="4.6" r="3.2"/>
      <circle class="pc-solid" cx="29" cy="6.2" r="2.8"/>
      <circle class="pc-solid" cx="38" cy="9.4" r="3"/>
      <path class="pc-solid" d="M10.6 30h23.8v4H10.6zM8.8 34h27v4h-27zM7.4 38h30.2v4H7.4z"/>
    """,
    "K": """
      <path class="pc-solid" d="M20.4 2h4.2v4h4.2v4.2h-4.2v4.4h-4.2V10.2h-4.2V6h4.2z"/>
      <path class="pc-solid" d="M22.5 15c6.4 0 11.4 4.2 11.4 9.6 0 2.6-1.2 4.6-3 6.4H14.1c-1.8-1.8-3-3.8-3-6.4C11.1 19.2 16.1 15 22.5 15z"/>
      <path class="pc-solid" d="M10.6 31h23.8v4H10.6zM8.8 35h27v3.4h-27zM7.4 38.4h30.2v3.6H7.4z"/>
    """,
}

NEO = {
    "P": """
      <circle class="pc-solid" cx="22.5" cy="14" r="7"/>
      <path class="pc-solid" d="M22.5 22l10 17h-20z"/>
      <path class="pc-solid" d="M10 39h25v3H10z"/>
    """,
    "R": """
      <path class="pc-solid" d="M11 8h23v8H11z"/>
      <path class="pc-hole" d="M17 8h3v6h-3zM25 8h3v6h-3z"/>
      <path class="pc-solid" d="M14 16h17v20H14z"/>
      <path class="pc-solid" d="M9 36h27v6H9z"/>
    """,
    "N": """
      <path class="pc-solid" d="M14 39V26l6-9-4 1 1-6 7-3 2-6 3 7 6 4-3 4 4 8v13z"/>
      <circle class="pc-hole" cx="30" cy="15" r="2"/>
      <path class="pc-solid" d="M9 39h27v3H9z"/>
    """,
    "B": """
      <path class="pc-solid" d="M22.5 4l9 16c0 6-4 10-9 10s-9-4-9-10z"/>
      <path class="pc-hole" d="M21 14h3v10h-3z"/>
      <path class="pc-solid" d="M16 30h13l3 9H13z"/>
      <path class="pc-solid" d="M9 39h27v3H9z"/>
    """,
    "Q": """
      <path class="pc-solid" d="M22.5 3l6 10 7-4-3 12h-20l-3-12 7 4z"/>
      <path class="pc-solid" d="M13 23h19l-3 15H16z"/>
      <path class="pc-solid" d="M9 38h27v4H9z"/>
    """,
    "K": """
      <path class="pc-solid" d="M20.5 2h4v5h5v4h-5v5h-4v-5h-5V7h5z"/>
      <path class="pc-solid" d="M12 18h21l-3 20H15z"/>
      <path class="pc-hole" d="M19 22h7v5h-7z"/>
      <path class="pc-solid" d="M9 38h27v4H9z"/>
    """,
}

# An eleven-by-eleven bitmap for each piece: '#' is a drawn block.
PIXEL_BITMAPS = {
    "P": [
        "           ",
        "    ###    ",
        "   #####   ",
        "    ###    ",
        "    ###    ",
        "   #####   ",
        "   #####   ",
        "  #######  ",
        "  #######  ",
        " ######### ",
        " ######### ",
    ],
    "R": [
        "           ",
        " # ## ## # ",
        " ######### ",
        " ######### ",
        "  #######  ",
        "  #######  ",
        "  #######  ",
        "  #######  ",
        " ######### ",
        " ######### ",
        "###########",
    ],
    "N": [
        "    ##     ",
        "   ####  # ",
        "  ####### #",
        " ##########",
        " ## #######",
        "   ########",
        "   ####### ",
        "   ####### ",
        "  ######## ",
        " ######### ",
        "###########",
    ],
    "B": [
        "     #     ",
        "    ###    ",
        "   #####   ",
        "   ## ##   ",
        "   #####   ",
        "  #######  ",
        "  ## # ##  ",
        "  #######  ",
        "   #####   ",
        " ######### ",
        "###########",
    ],
    "Q": [
        " #   #   # ",
        " ##  #  ## ",
        " ### # ### ",
        " ######### ",
        " ######### ",
        "  #######  ",
        "  #######  ",
        "  #######  ",
        " ######### ",
        " ######### ",
        "###########",
    ],
    "K": [
        "     #     ",
        "    ###    ",
        "   #####   ",
        "    ###    ",
        "  #######  ",
        " ######### ",
        " ## ### ## ",
        " ######### ",
        "  #######  ",
        " ######### ",
        "###########",
    ],
}


def _pixel_svg(rows: list[str]) -> str:
    cell = 45 / 11
    parts = []
    for y, row in enumerate(rows):
        x = 0
        while x < len(row):
            if row[x] == "#":
                run = 0
                while x + run < len(row) and row[x + run] == "#":
                    run += 1
                parts.append(
                    f'<rect class="pc-solid" x="{x * cell:.2f}" y="{y * cell:.2f}" '
                    f'width="{run * cell:.2f}" height="{cell:.2f}"/>'
                )
                x += run
            else:
                x += 1
    return "".join(parts)


PIXEL = {key: _pixel_svg(rows) for key, rows in PIXEL_BITMAPS.items()}

SETS = {
    "Classic": CLASSIC,
    "Staunton Flat": STAUNTON,
    "Neo": NEO,
    "Pixel": PIXEL,
}

SET_SLUG = {
    "Classic": "classic",
    "Staunton Flat": "staunton",
    "Neo": "neo",
    "Pixel": "pixel",
}


def sprite() -> str:
    """One inline sprite carrying every shape of every flat set."""
    out = ['<svg xmlns="http://www.w3.org/2000/svg" class="piece-sprite" aria-hidden="true" focusable="false">']
    for set_name, shapes in SETS.items():
        slug = SET_SLUG[set_name]
        for letter, markup in shapes.items():
            out.append(f'<symbol id="pc-{slug}-{letter}" viewBox="0 0 45 45">{markup}</symbol>')
    out.append("</svg>")
    return "".join(out)
