"""The WSGI application: every request goes to the API or to a page."""
import sys
import traceback

from . import api, httpbase, web
from .errors import TesselError
from .httpbase import Request, STATUS_TEXT


def _handle(request):
    if request.path == "/api" or request.path.startswith("/api/"):
        return api.dispatch(request)
    return web.dispatch(request)


def application(environ, start_response):
    request = Request(environ)
    try:
        response = _handle(request)
    except TesselError as refusal:
        response = httpbase.api_refusal(request, refusal)
    except Exception:
        traceback.print_exc(file=sys.stderr)
        response = httpbase.api_refusal(
            request,
            TesselError(
                "VALIDATION_ERROR",
                message="The request could not be completed",
            ),
        )
    body = b"" if request.method == "HEAD" else response.body
    headers = list(response.headers)
    headers.append(("Content-Length", str(len(body))))
    start_response(
        STATUS_TEXT.get(response.status, "%d Status" % response.status), headers
    )
    return [body]
