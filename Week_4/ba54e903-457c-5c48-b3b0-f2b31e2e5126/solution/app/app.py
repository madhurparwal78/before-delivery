"""WSGI entry point: ``gunicorn app:app``."""

from hub import create_app

app = create_app()
