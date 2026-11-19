"""The certificate body and its SVG image, built with ElementTree so user text is always escaped text."""

from xml.etree import ElementTree as ET

from starlette.responses import JSONResponse, Response

from . import scoring
from .accounts import User
from .db import DB
from .errors import NO_STORE, ApiError
from .event import NAME

SVG = "http://www.w3.org/2000/svg"
INK, LIME, PAPER, MUTED = "#f3f6fb", "#a3e635", "#0b1222", "#aab6ca"


async def _certificate(user: User) -> scoring.Certificate:
    async with DB.connection() as conn:
        found = await scoring.certificate_for(conn, user.id)
    if found is None:
        raise ApiError(403, "not_complete")
    return found


async def body(user: User) -> Response:
    cert = await _certificate(user)
    return JSONResponse({"display_name": cert.display_name, "team_name": cert.team_name, "event_name": NAME,
                         "issued_on": scoring.iso(cert.issued_on)}, headers=NO_STORE)


def _text(parent: ET.Element, value: str, y: int, size: int, fill: str, family: str, weight: str = "400") -> None:
    node = ET.SubElement(parent, "text", {"x": "600", "y": str(y), "text-anchor": "middle", "fill": fill,
                                          "font-size": str(size), "font-family": family, "font-weight": weight})
    node.text = value


def render_svg(cert: scoring.Certificate) -> bytes:
    ET.register_namespace("", SVG)
    root = ET.Element(f"{{{SVG}}}svg", {"viewBox": "0 0 1200 850", "width": "1200", "height": "850",
                                         "role": "img"})
    ET.SubElement(root, "rect", {"width": "1200", "height": "850", "fill": PAPER})
    ET.SubElement(root, "rect", {"x": "36", "y": "36", "width": "1128", "height": "778", "rx": "28", "fill": "none",
                                 "stroke": LIME, "stroke-width": "4"})
    ET.SubElement(root, "rect", {"x": "56", "y": "56", "width": "1088", "height": "738", "rx": "18", "fill": "none",
                                 "stroke": MUTED, "stroke-opacity": "0.35", "stroke-width": "1.5"})
    shield = ET.SubElement(root, "g", {"transform": "translate(560 92)", "fill": "none", "stroke": LIME,
                                       "stroke-width": "4", "stroke-linejoin": "round", "stroke-linecap": "round"})
    ET.SubElement(shield, "path", {"d": "M40 4 L74 16 V44 C74 66 58 80 40 88 C22 80 6 66 6 44 V16 Z"})
    ET.SubElement(shield, "path", {"d": "M24 46 L36 58 L58 34"})
    sans = "Source Sans Pro, system-ui, sans-serif"
    _text(root, "Certificate of completion", 268, 30, MUTED, sans, "600")
    _text(root, cert.display_name, 370, 64, INK, sans, "700")
    _text(root, cert.team_name, 440, 34, LIME, sans, "600")
    _text(root, NAME, 548, 44, INK, sans, "700")
    _text(root, "22 to 26 October 2026", 604, 26, MUTED, sans)
    _text(root, scoring.iso(cert.issued_on), 700, 24, MUTED, sans)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


async def image(user: User) -> Response:
    cert = await _certificate(user)
    return Response(render_svg(cert), media_type="image/svg+xml",
                    headers={**NO_STORE, "Content-Disposition": 'attachment; filename="downtime-certificate.svg"'})
