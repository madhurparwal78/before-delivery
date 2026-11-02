"""The one envelope and the one refusal path for the whole API."""
import decimal
import time
import uuid

from aiohttp import web

from .textutil import ApiError

NO_STORE = {"Cache-Control": "no-store"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
}


def fresh_request_id():
    return str(uuid.uuid4())


def _default(obj):
    if isinstance(obj, decimal.Decimal):
        return int(obj)
    raise TypeError(obj)


def json_api_response(status=200, data=None, error=None, headers=None, started=None):
    latency = (time.monotonic() - started) * 1000 if started else 0
    body = {
        "success": error is None,
        "data": data,
        "error": None if error is None else
            {"code": error.code, "message": error.message, "field": error.field},
        "meta": {"request_id": fresh_request_id(), "latency_ms": int(latency)},
    }
    hdrs = dict(NO_STORE)
    hdrs.update(SECURITY_HEADERS)
    if headers:
        hdrs.update(headers)
    return web.json_response(body, status=status, headers=hdrs,
                             dumps=lambda o: __import__("json").dumps(o, ensure_ascii=False, default=_default))


def error_body(err, started):
    latency = (time.monotonic() - started) * 1000 if started else 0
    return {
        "success": False,
        "data": None,
        "error": {"code": err.code, "message": err.message, "field": err.field},
        "meta": {"request_id": fresh_request_id(), "latency_ms": int(latency)},
    }


def error_response(err, request=None, started=None):
    hdrs = dict(NO_STORE)
    hdrs.update(SECURITY_HEADERS)
    if err.headers:
        hdrs.update(err.headers)
    body = error_body(err, started)
    return web.json_response(body, status=err.status, headers=hdrs,
                             dumps=lambda o: __import__("json").dumps(o, ensure_ascii=False, default=_default))
