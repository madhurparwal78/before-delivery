"""Build step: verify every template compiles and create the reserved, empty directories at the app root."""
from pathlib import Path

from . import config
from .pages import env

APP_ROOT = config.ROOT.parent


def main() -> None:
    for name in env.list_templates():
        env.get_template(name)
    for directory in (".browser_screenshots", ".downloads"):
        Path(APP_ROOT, directory).mkdir(exist_ok=True)
    print("keystone build ok")


if __name__ == "__main__":
    main()
