"""Frontend build: renders HTML pages with the shared chrome."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "darkframe" / "static"
PAGES_DIR = STATIC / "pages"
NAV = [
    ("plan", "Plan", "/plan"),
    ("projects", "Projects", "/projects"),
    ("sessions", "Sessions", "/sessions"),
    ("library", "Library", "/library"),
    ("site", "Site", "/site"),
]


def nav_html(active: str) -> str:
    links = "".join(
        f'<a class="nav-link{" is-active" if key == active else ""}" href="{href}">{label}</a>'
        for key, label, href in NAV
    )
    return f'<nav class="app-nav" aria-label="Main">{links}</nav>'


def chrome(title: str, active: str, body: str, scripts: str, private: bool = True) -> str:
    nav = nav_html(active) if private else ""
    lock = '<button id="lock-workspace" class="ghost-btn" type="button">Lock workspace</button>' if private else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="/static/css/darkframe.css">
<link rel="stylesheet" href="/static/css/layout.css">
<link rel="icon" href="data:,">
</head>
<body data-screen="{active}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="app-header">
  <a class="brand" href="/plan"><span class="brand-mark" aria-hidden="true"></span>Darkframe</a>
  {nav}
  {lock}
</header>
<main id="main" class="app-main" tabindex="-1">
{body}
</main>
{scripts}
</body>
</html>"""


def build() -> None:
    (STATIC).mkdir(parents=True, exist_ok=True)
    sources = {
        "unlock.html": ("Unlock", "unlock", False),
        "plan.html": ("Plan", "plan", True),
        "projects.html": ("Projects", "projects", True),
        "sessions.html": ("Sessions", "sessions", True),
        "library.html": ("Library", "library", True),
        "site.html": ("Site", "site", True),
        "shared.html": ("Shared", "shared", False),
        "project.html": ("Project", "projects", True),
    }
    for name, (title, active, private) in sources.items():
        src = PAGES_DIR / name
        if not src.is_file():
            continue
        raw = src.read_text()
        body = raw
        scripts = ""
        if "<script" in raw:
            head, rest = raw.split("<script", 1)
            body = head
            scripts = "<script" + rest
        out = STATIC / name
        out.write_text(chrome(title, active, body, scripts, private))
    print("darkframe build complete")


def main() -> None:
    build()


if __name__ == "__main__":
    main()
