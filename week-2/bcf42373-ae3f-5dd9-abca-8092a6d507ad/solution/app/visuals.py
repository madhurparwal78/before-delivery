"""Generated visuals: gradient compositions crossed by stage-grid hairlines, drawn from a record's stored fields,
so the same record always draws the same picture and neighbours differ."""

import hashlib

from markupsafe import Markup, escape

# The stage grid in a 100 x 100 box: a centred square, four corner diagonals, a cross and a diamond.
STAGE_LINES = (
    (30, 30, 70, 30), (70, 30, 70, 70), (70, 70, 30, 70), (30, 70, 30, 30),
    (0, 0, 30, 30), (100, 0, 70, 30), (100, 100, 70, 70), (0, 100, 30, 70),
    (50, 0, 50, 30), (100, 50, 70, 50), (50, 100, 50, 70), (0, 50, 30, 50),
    (50, 0, 100, 50), (100, 50, 50, 100), (50, 100, 0, 50), (0, 50, 50, 0),
)


def _lines(lines, stroke: str) -> str:
    return "".join(
        f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{stroke}" vector-effect="non-scaling-stroke"/>'
        for x1, y1, x2, y2 in lines)


def stage_grid() -> Markup:
    return Markup(
        '<svg class="stage-lines" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
        f'{_lines(STAGE_LINES, "#990000")}</svg>')


def visual(*fields, label: str | None = None, variant: int = 0, order: int | None = None, css_class: str = "") -> Markup:
    """A composition seeded by the given stored fields; `order` (a case study's position) picks the composition so
    neighbours in the catalogue differ. `label` names the record for assistive technology; without it the visual
    is decorative."""
    digest = hashlib.sha256("|".join(str(field) for field in fields).encode()).digest()
    mode = ((digest[0] if order is None else order) + variant) % 4
    angle = (digest[1] * 360 // 256 + variant * 137) % 360
    glow_x = 18 + digest[2] * 64 // 256
    glow_y = 18 + digest[3] * 64 // 256
    reach = 34 + digest[4] % 30
    stop = 30 + digest[5] % 35
    picked = [line for bit, line in enumerate(STAGE_LINES) if digest[6 + bit // 8] >> (bit % 8) & 1][:7]
    spacing = 10 + digest[9] % 26
    style = f"--ga:{angle}deg;--gx:{glow_x}%;--gy:{glow_y}%;--gr:{reach}%;--gs:{stop}%;--gp:{spacing}px"
    naming = (f'role="img" aria-label="Generated artwork for {escape(label)}"' if label
              else 'aria-hidden="true"')
    return Markup(
        f'<div class="gv gv-m{mode} {css_class}" style="{style}" {naming}>'
        '<svg class="gv-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
        f'{_lines(picked, "rgba(255,255,255,0.22)")}</svg><span class="gv-frame"></span></div>')
