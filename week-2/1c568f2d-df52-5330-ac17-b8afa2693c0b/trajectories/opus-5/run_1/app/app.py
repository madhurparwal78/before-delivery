"""WSGI entry point for Clearhouse."""
from clearhouse.web import create_app

app = create_app()
