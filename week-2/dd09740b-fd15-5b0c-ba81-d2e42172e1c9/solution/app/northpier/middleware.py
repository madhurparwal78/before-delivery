"""The server boundary: 405 on status addresses first, then the body size limit, then every refusal, outage and
unexpected failure turned into its answer (never a 5xx other than the 503 outage)."""
import re
import sys
import traceback
from collections.abc import Callable

from django.http import HttpRequest, HttpResponse

from northpier import db
from northpier.bodies import BODY_LIMIT
from northpier.errors import Refusal, refuse
from northpier.pages import outage_page, page_refusal

STATUS_ADDRESS = re.compile(r"/(api/inquiries/status|inquiry)/[^/]+/?")


class Boundary:
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        try:
            if STATUS_ADDRESS.fullmatch(request.path) and request.method not in ("GET", "HEAD"):
                raise Refusal("method")
            if request.method not in ("GET", "HEAD"):
                declared = request.META.get("CONTENT_LENGTH") or "0"
                if not declared.isdigit() or int(declared) > BODY_LIMIT or len(request.body) > BODY_LIMIT:
                    raise Refusal("too_large")
        except Refusal as refusal:
            return self._refused(request, refusal)
        return self.get_response(request)

    def process_exception(self, request: HttpRequest, exception: Exception) -> HttpResponse:
        if isinstance(exception, Refusal):
            return self._refused(request, exception)
        if not isinstance(exception, db.Unavailable):
            traceback.print_exception(exception, file=sys.stderr)
        return self._refused(request, Refusal("outage"))

    @staticmethod
    def _refused(request: HttpRequest, refusal: Refusal) -> HttpResponse:
        if request.path.startswith("/api/"):
            return refuse(refusal)
        if refusal.kind == "outage":
            return outage_page(request)
        return page_refusal(request, refusal)
