"""Inputs for the drawn covers and avatars: every picture in Mela is made from colours and lettering."""
import hashlib

AVATAR_TINTS = ["amber", "harbor", "moss", "plum", "ember"]


def _seed(text):
    return hashlib.sha256(text.encode()).digest()


def cover_style(slug):
    """CSS custom properties that place each event's gradient layers differently, so no two posters match."""
    b = _seed(slug)
    return (f"--c1x:{10 + b[0] % 60}%;--c1y:{8 + b[1] % 40}%;--c2x:{40 + b[2] % 55}%;--c2y:{45 + b[3] % 50}%;"
            f"--ca:{b[4] * 360 // 256}deg;--cs:{8 + b[5] % 10}%;--cr:{-4 + b[6] % 9}deg")


def initials(name):
    parts = [part for part in name.replace("-", " ").split() if part[:1].isalnum()]
    letters = "".join(part[0] for part in parts[:1] + parts[1:][-1:])
    return letters.upper() or "?"


def avatar_tint(text):
    return AVATAR_TINTS[_seed(text)[0] % len(AVATAR_TINTS)]
