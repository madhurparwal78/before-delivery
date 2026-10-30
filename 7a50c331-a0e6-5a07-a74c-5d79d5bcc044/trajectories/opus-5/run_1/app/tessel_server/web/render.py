"""The template environment every page is rendered with."""
import os

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .. import pricing
from . import content

TEMPLATES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates")

_environment = Environment(
    loader=FileSystemLoader(TEMPLATES),
    autoescape=select_autoescape(["html"]),
    trim_blocks=True,
    lstrip_blocks=True,
)
_environment.globals["content"] = content
_environment.globals["money"] = pricing.format_money
_environment.globals["count"] = pricing.format_count


def page(name, **values):
    return _environment.get_template(name).render(**values)
