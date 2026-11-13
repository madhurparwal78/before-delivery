"""The Northfall Reference Desk: one origin, one backing service.

Pages and the API share one origin, the API under ``/api``. The app creates
its schema and applies the seed on start, retrying while Postgres is absent.
"""

from __future__ import annotations

import threading

import db
import pages
import store
from api import ApiError, api, json_response
from flask import Flask

_ready = threading.Event()
_boot_lock = threading.Lock()


def _ensure_boot():
    """Schema then seed once, retried until Postgres answers.

    The boot attempt runs in the background and never blocks a request for
    longer than one try: a try that fails releases the lock, resets the
    pool and lets the next attempt try again.
    """
    if _ready.is_set():
        return
    with _boot_lock:
        if _ready.is_set():
            return
        try:
            store.ensure_ready()
            _ready.set()
        except db.Unavailable:
            db.reset_pool()


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.url_map.strict_slashes = False
    app.register_blueprint(api)
    app.register_blueprint(pages.pages)
    pages.install_error_handlers(app)
    app.before_request(_ensure_boot)

    @app.errorhandler(ApiError)
    def handle_api_error(error):
        return json_response(error.payload, error.status)

    return app


app = create_app()


def _boot_background():
    """Retry the boot every second until Postgres answers."""
    while not _ready.is_set():
        _ensure_boot()
        _ready.wait(1.0)


threading.Thread(target=_boot_background, daemon=True).start()
