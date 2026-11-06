"""The single refusal type: every refused request is raised as a Refusal and rendered in one error shape."""

from dataclasses import dataclass
from dataclasses import field as dataclass_field


@dataclass
class Refusal(Exception):
    status: int
    message: str
    field: str | None = None
    extra: dict = dataclass_field(default_factory=dict)

    def body(self) -> dict:
        error: dict = {"message": self.message}
        if self.field is not None:
            error["field"] = self.field
        if "lines" in self.extra:
            error["lines"] = self.extra["lines"]
        body: dict = {"error": error}
        if "current" in self.extra:
            body["current"] = self.extra["current"]
        return body


NOT_FOUND = "Not found"
ROLE_REFUSED = "Your role may not do that"


def not_found() -> Refusal:
    return Refusal(404, NOT_FOUND)


def role_refused() -> Refusal:
    return Refusal(403, ROLE_REFUSED)


def invalid(field_name: str, message: str) -> Refusal:
    return Refusal(400, message, field_name)
