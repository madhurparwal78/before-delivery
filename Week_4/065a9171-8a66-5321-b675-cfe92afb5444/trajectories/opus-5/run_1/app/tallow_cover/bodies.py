"""Published body keys: every JSON write endpoint accepts exactly its own keys."""

from __future__ import annotations

from .errors import FIELD_MESSAGES, validation_error


class Body:
    """A parsed JSON body, its unknown keys and the field errors found so far."""

    def __init__(self, payload: dict, published: tuple[str, ...]):
        self.payload = payload
        self.errors: dict[str, str] = {
            key: FIELD_MESSAGES["unknown_key"] for key in payload if key not in published
        }

    def get(self, key: str, default=None):
        return self.payload.get(key, default)

    def has(self, key: str) -> bool:
        return key in self.payload

    def fail(self, field: str, message_key: str) -> None:
        self.errors.setdefault(field, FIELD_MESSAGES[message_key])

    def fail_with(self, field: str, message: str) -> None:
        self.errors.setdefault(field, message)

    def check(self) -> None:
        """Validation is judged last, so handlers call this after every other check."""
        if self.errors:
            raise validation_error(self.errors)
