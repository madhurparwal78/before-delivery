"""Clearhouse: the Fenwick Science Centre clearance desk."""

from flask import Flask

from . import boundary, icons
from .api import api
from .pages import not_found_page, pages


def create_app() -> Flask:
    app = Flask(__name__)
    app.json.ensure_ascii = False
    app.jinja_env.globals.update(icon_sprite=icons.SPRITE, tab_icon=icons.TAB_ICON)
    boundary.install(app, not_found_page)
    app.register_blueprint(api)
    app.register_blueprint(pages)
    return app
