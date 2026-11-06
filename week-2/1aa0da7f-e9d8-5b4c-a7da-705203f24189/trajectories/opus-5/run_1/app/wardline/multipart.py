"""A streaming multipart reader: the file never sits whole in memory."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import AsyncIterator, Awaitable, Callable

HEADER_LIMIT = 65536
FIELD_LIMIT = 1_000_000
_NAME_RE = re.compile(r'name="([^"]*)"')
_FILENAME_RE = re.compile(r'filename="([^"]*)"')


class MultipartError(Exception):
    """The body could not be read."""


class FileTooLarge(Exception):
    """The file part, or the whole body, is over its limit."""


@dataclass
class FilePart:
    filename: str | None = None
    content_type: str | None = None
    size: int = 0
    present: bool = False


@dataclass
class Form:
    fields: dict[str, str] = field(default_factory=dict)
    file: FilePart = field(default_factory=FilePart)


def boundary_of(content_type: str | None) -> bytes | None:
    if not content_type or "multipart/form-data" not in content_type.lower():
        return None
    for piece in content_type.split(";"):
        piece = piece.strip()
        if piece.lower().startswith("boundary="):
            value = piece[len("boundary=") :].strip()
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            return value.encode("latin-1") if value else None
    return None


def _part_headers(raw: bytes) -> tuple[str | None, str | None, str | None]:
    name = filename = content_type = None
    for line in raw.decode("latin-1").split("\r\n"):
        lowered = line.lower()
        if lowered.startswith("content-disposition:"):
            found = _NAME_RE.search(line)
            name = found.group(1) if found else None
            found = _FILENAME_RE.search(line)
            filename = found.group(1) if found else None
        elif lowered.startswith("content-type:"):
            content_type = line.split(":", 1)[1].strip()
    return name, filename, content_type


async def read_form(
    chunks: AsyncIterator[bytes],
    boundary: bytes,
    file_field: str,
    sink: Callable[[bytes], Awaitable[None]],
    max_total: int,
    max_file: int,
) -> Form:
    delimiter = b"--" + boundary
    buffer = bytearray()
    form = Form()
    total = 0
    finished = False

    async def more() -> bool:
        nonlocal total, finished
        if finished:
            return False
        try:
            chunk = await chunks.__anext__()
        except StopAsyncIteration:
            finished = True
            return False
        total += len(chunk)
        if total > max_total:
            raise FileTooLarge()
        buffer.extend(chunk)
        return True

    while delimiter not in buffer:
        if not await more():
            raise MultipartError()
    del buffer[: buffer.index(delimiter) + len(delimiter)]

    while True:
        while len(buffer) < 2:
            if not await more():
                raise MultipartError()
        if buffer[:2] == b"--":
            return form
        if buffer[:2] != b"\r\n":
            raise MultipartError()
        del buffer[:2]
        while b"\r\n\r\n" not in buffer:
            if len(buffer) > HEADER_LIMIT or not await more():
                raise MultipartError()
        split = buffer.index(b"\r\n\r\n")
        name, filename, content_type = _part_headers(bytes(buffer[:split]))
        del buffer[: split + 4]
        is_file = name == file_field
        if is_file:
            form.file.present = True
            form.file.filename = filename
            form.file.content_type = content_type
        collected = bytearray()
        separator = b"\r\n" + delimiter

        async def emit(payload: bytes) -> None:
            if not payload:
                return
            if is_file:
                form.file.size += len(payload)
                if form.file.size > max_file:
                    raise FileTooLarge()
                await sink(payload)
            else:
                if len(collected) + len(payload) > FIELD_LIMIT:
                    raise MultipartError()
                collected.extend(payload)

        while True:
            position = buffer.find(separator)
            if position != -1:
                await emit(bytes(buffer[:position]))
                del buffer[: position + len(separator)]
                break
            keep = len(separator) + 2
            if len(buffer) > keep:
                await emit(bytes(buffer[:-keep]))
                del buffer[:-keep]
            if not await more():
                raise MultipartError()
        if not is_file and name is not None:
            try:
                form.fields[name] = collected.decode("utf-8")
            except UnicodeDecodeError:
                raise MultipartError() from None
