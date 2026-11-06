"""The one error shape every Mela endpoint answers with."""


class MelaError(Exception):
    """A refusal carrying its status, its code or its per-field messages."""

    def __init__(
        self,
        status: int,
        code: str | None = None,
        errors: dict | None = None,
        extra: dict | None = None,
        headers: dict | None = None,
    ):
        super().__init__(code or "invalid")
        self.status = status
        self.code = code
        self.errors = errors
        self.extra = extra or {}
        self.headers = headers or {}

    @property
    def body(self) -> dict:
        if self.errors is not None:
            return {"errors": self.errors}
        return {"error": self.code, **self.extra}


def not_found() -> MelaError:
    return MelaError(404, "not_found")


def unauthenticated() -> MelaError:
    return MelaError(401, "unauthenticated")


def from_refusal(refusal: dict) -> MelaError:
    """Turn a decision made inside a transaction into the shared error shape."""
    if "errors" in refusal:
        return MelaError(refusal["http"], errors=refusal["errors"])
    extra = {k: v for k, v in refusal.items() if k not in ("http", "code")}
    headers = {}
    if "retry_after" in extra:
        headers["Retry-After"] = str(extra["retry_after"])
    return MelaError(refusal["http"], refusal["code"], extra=extra, headers=headers)
