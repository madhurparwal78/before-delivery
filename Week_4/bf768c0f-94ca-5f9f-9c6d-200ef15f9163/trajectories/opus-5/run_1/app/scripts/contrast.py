#!/usr/bin/env python3
"""Check the board theme contrast ratios the brief pins."""


def lum(hex_colour):
    hex_colour = hex_colour.lstrip('#')
    parts = [int(hex_colour[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    srgb = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in parts]
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2]


def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


COORD_ON_LIGHT = '#2a211b'   # a deep warm neutral
COORD_ON_DARK = '#f5f1ec'    # a near-white neutral

THEMES = {
    'Walnut': ('#f2e3cd', '#4a3122'),
    'Slate': ('#e9eaec', '#4f555d'),
    'Ocean': ('#e4edf3', '#1d4258'),
    'Forest': ('#e8efe4', '#23402a'),
    'Neon': ('#ece8f4', '#382457'),
}

TEXT_CHECKS = {
    'body text on page ground': ('#f3efe9', '#1b1512'),
    'secondary text on page ground': ('#cfc9c1', '#1b1512'),
    'quiet text on page ground': ('#9f9890', '#1b1512'),
    'accent on page ground': ('#7cc45c', '#1b1512'),
    'link on page ground': ('#5fb8e8', '#1b1512'),
    'danger on page ground': ('#f2654f', '#1b1512'),
    'caution on page ground': ('#f5c762', '#1b1512'),
    'warning on page ground': ('#f08b3c', '#1b1512'),
    'bronze on page ground': ('#e0a86b', '#1b1512'),
    'body text on surface': ('#f3efe9', '#241c18'),
    'secondary on surface': ('#cfc9c1', '#241c18'),
    'quiet on surface': ('#9f9890', '#241c18'),
    'accent on surface': ('#7cc45c', '#241c18'),
    'link on surface': ('#5fb8e8', '#241c18'),
    'danger on surface': ('#f2654f', '#241c18'),
    'button label on accent': ('#12240c', '#5ea83e'),
    'danger label on danger': ('#2a0b06', '#f2654f'),
}

ok = True
print('Board themes')
for name, (light, dark) in THEMES.items():
    pair = ratio(light, dark)
    on_light = ratio(COORD_ON_LIGHT, light)
    on_dark = ratio(COORD_ON_DARK, dark)
    good = pair >= 3 and on_light >= 4.5 and on_dark >= 4.5
    ok = ok and good
    print(f'  {name:7s} light/dark {pair:5.2f}  coord-on-light {on_light:5.2f}  coord-on-dark {on_dark:5.2f}  {"ok" if good else "FAIL"}')

print('\nInterface text')
for label, (fg, bg) in TEXT_CHECKS.items():
    value = ratio(fg, bg)
    good = value >= 4.5
    ok = ok and good
    print(f'  {label:34s} {value:5.2f}  {"ok" if good else "FAIL"}')

print('\nall good' if ok else '\nsomething is below the bar')
raise SystemExit(0 if ok else 1)
