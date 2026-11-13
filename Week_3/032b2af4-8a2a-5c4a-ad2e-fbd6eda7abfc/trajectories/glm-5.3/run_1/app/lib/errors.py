"""Shared error shape for every /api error."""
import json


class ApiError(Exception):
    def __init__(self, status: int, code: str, fields: dict | None = None, message: str | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.fields = fields
        self.message = message

    def body(self) -> dict:
        out = {"error": self.code}
        if self.fields:
            out["fields"] = self.fields
        if self.message:
            out["message"] = self.message
        return out


def error_response(status: int, code: str, fields: dict | None = None, message: str | None = None) -> tuple:
    payload = ApiError(status, code, fields, message).body()
    return status, [("Content-Type", "application/json; charset=utf-8")], json.dumps(payload).encode()
