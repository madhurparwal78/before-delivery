"""Sniffing, page inspection and the displayed-page raster.

The inspect, preview, find and render functions run in worker processes, so the server keeps
answering while a large file is rasterised.
"""

from __future__ import annotations

import asyncio
import math
import re
import struct
import zlib
from collections.abc import Callable
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from fractions import Fraction
from functools import partial
from multiprocessing import get_context
from typing import Any, BinaryIO

import pypdfium2
import pypdfium2.raw as pdfium_c
from PIL import Image, UnidentifiedImageError

Image.MAX_IMAGE_PIXELS = None

MAX_PIXELS = 40_000_000
MAX_PAGES = 200
DPI = Fraction(150, 72)
EXTENSIONS = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "audio/wav": "wav", "audio/mpeg": "mp3"}
ACCEPTED = tuple(EXTENSIONS)
IMAGE_TYPES = ("image/png", "image/jpeg")


def sniff(head: bytes) -> str | None:
    """The accepted type judged by leading bytes, or None."""
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WAVE":
        return "audio/wav"
    if head.startswith(b"ID3") or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0 and head[1] & 0x06):
        return "audio/mpeg"
    return None


def _points(value: float) -> Fraction:
    """A page size in points, free of float noise from PDFium's single precision."""
    return Fraction(round(value * 10_000), 10_000)


def _displayed_size(page: Any) -> tuple[int, int]:
    width, height = page.get_size()
    return math.ceil(_points(width) * DPI), math.ceil(_points(height) * DPI)


def _page_pixels(page: Any) -> int:
    width, height = _displayed_size(page)
    return width * height


def inspect(path: str, sniffed_type: str) -> tuple[int | None, bool]:
    """(page_count, over_render_limits), reading no pixel data."""
    if sniffed_type in IMAGE_TYPES:
        try:
            with Image.open(path) as picture:
                return 1, picture.width * picture.height > MAX_PIXELS
        except (OSError, UnidentifiedImageError, ValueError, SyntaxError, struct.error):
            return None, False
    try:
        document = pypdfium2.PdfDocument(path)
    except pypdfium2.PdfiumError:
        return None, False
    try:
        count = len(document)
        if count > MAX_PAGES:
            return count, True
        for index in range(count):
            page = document[index]
            try:
                if _page_pixels(page) > MAX_PIXELS:
                    return count, True
            finally:
                page.close()
        return count, False
    finally:
        document.close()


def _flatten(picture: Image.Image) -> Image.Image:
    """8-bit RGB from any input: palette, greyscale, 16-bit, CMYK; transparency flattens onto white."""
    if picture.mode in ("I;16", "I;16B", "I;16L", "I"):
        picture = picture.point(lambda value: value / 257).convert("L")
    if picture.mode in ("RGBA", "LA", "PA") or "transparency" in picture.info:
        rgba = picture.convert("RGBA")
        ground = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        ground.alpha_composite(rgba)
        return ground.convert("RGB")
    return picture.convert("RGB")


def _displayed_image(path: str) -> Image.Image:
    with Image.open(path) as picture:
        picture.seek(0)
        orientation = picture.getexif().get(0x0112, 1) if picture.format == "JPEG" else 1
        if orientation not in range(1, 9):
            orientation = 1
        picture.load()
        flat = _flatten(picture)
    method = {2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180, 4: Image.Transpose.FLIP_TOP_BOTTOM,
              5: Image.Transpose.TRANSPOSE, 6: Image.Transpose.ROTATE_270, 7: Image.Transpose.TRANSVERSE,
              8: Image.Transpose.ROTATE_90}.get(orientation)
    return flat.transpose(method) if method else flat


def _displayed_pdf_page(document: Any, form_env: Any, index: int) -> Image.Image:
    page = document[index]
    try:
        width, height = _displayed_size(page)
        bitmap = pypdfium2.PdfBitmap.new_native(width, height, pdfium_c.FPDFBitmap_BGRx)
        bitmap.fill_rect(0, 0, width, height, (255, 255, 255, 255))
        pdfium_c.FPDF_RenderPageBitmap(bitmap, page, 0, 0, width, height, 0, pdfium_c.FPDF_ANNOT)
        if form_env is not None:
            pdfium_c.FPDF_FFLDraw(form_env, bitmap, page, 0, 0, width, height, 0, pdfium_c.FPDF_ANNOT)
        picture = bitmap.to_pil().convert("RGB")
        bitmap.close()
        return picture
    finally:
        page.close()


def _open_pdf(path: str) -> tuple[Any, Any]:
    document = pypdfium2.PdfDocument(path)
    document.init_forms()
    return document, document.formenv


def _burn(picture: Image.Image, regions: list[dict]) -> None:
    """Fill solid black, rounded outward in both axes, so no covered pixel survives."""
    width, height = picture.size
    for region in regions:
        left = region["x"] * width // 1000
        top = region["y"] * height // 1000
        right = -((-(region["x"] + region["w"]) * width) // 1000)
        bottom = -((-(region["y"] + region["h"]) * height) // 1000)
        picture.paste((0, 0, 0), (left, top, right, bottom))


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def _write_png(picture: Image.Image, out: BinaryIO) -> None:
    """IHDR, IDAT and IEND only: nothing from the input survives but the pixels."""
    width, height = picture.size
    out.write(b"\x89PNG\r\n\x1a\n")
    out.write(png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)))
    packer = zlib.compressobj(6)
    pixels = memoryview(picture.tobytes())
    stride = width * 3
    pending = bytearray()
    for row in range(height):
        pending += packer.compress(b"\0" + pixels[row * stride : (row + 1) * stride])
        if len(pending) >= 1 << 20:
            out.write(png_chunk(b"IDAT", bytes(pending)))
            pending.clear()
    pending += packer.flush()
    out.write(png_chunk(b"IDAT", bytes(pending)))
    out.write(png_chunk(b"IEND", b""))


def _pdf_number(value: Fraction) -> str:
    text = f"{float(value):.4f}".rstrip("0").rstrip(".")
    return text or "0"


def _write_pdf(pages: list[tuple[int, int, bytes]], out: BinaryIO) -> None:
    """Catalog, page tree, pages, their content streams and one lossless image each. No dates, ids or /Info."""
    offsets: dict[int, int] = {}
    written = [0]

    def emit(data: bytes) -> None:
        out.write(data)
        written[0] += len(data)

    def obj(number: int, body: bytes) -> None:
        offsets[number] = written[0]
        emit(b"%d 0 obj\n" % number + body + b"\nendobj\n")

    emit(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
    kids = " ".join(f"{3 + i * 3} 0 R" for i in range(len(pages)))
    obj(1, b"<< /Pages 2 0 R /Type /Catalog >>")
    obj(2, f"<< /Count {len(pages)} /Kids [{kids}] /Type /Pages >>".encode())
    for index, (width, height, deflated) in enumerate(pages):
        page, content, image = 3 + index * 3, 4 + index * 3, 5 + index * 3
        wide, tall = _pdf_number(width / DPI), _pdf_number(height / DPI)
        obj(
            page,
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {wide} {tall}] /Resources << /XObject << /Im0 {image} 0 R >> >>"
            f" /Contents {content} 0 R >>".encode(),
        )
        draw = f"q {wide} 0 0 {tall} 0 0 cm /Im0 Do Q".encode()
        obj(content, b"<< /Length %d >>\nstream\n" % len(draw) + draw + b"\nendstream")
        header = (
            f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB"
            f" /BitsPerComponent 8 /Filter /FlateDecode /Length {len(deflated)} >>\nstream\n"
        ).encode()
        obj(image, header + deflated + b"\nendstream")
    start = written[0]
    size = 3 + len(pages) * 3
    emit(f"xref\n0 {size}\n0000000000 65535 f \n".encode())
    for number in range(1, size):
        emit(f"{offsets[number]:010d} 00000 n \n".encode())
    emit(f"trailer\n<< /Size {size} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())


def render_preview(path: str, sniffed_type: str, page: int, out_path: str) -> None:
    if sniffed_type in IMAGE_TYPES:
        picture = _displayed_image(path)
    else:
        document, form_env = _open_pdf(path)
        try:
            picture = _displayed_pdf_page(document, form_env, page - 1)
        finally:
            document.close()
    with open(out_path, "wb") as out:
        _write_png(picture, out)


def render_derivative(path: str, sniffed_type: str, regions: list[dict], out_path: str) -> tuple[str, int]:
    """Write the burned-in derivative. Returns (content_type, page_count)."""
    if sniffed_type in IMAGE_TYPES:
        picture = _displayed_image(path)
        _burn(picture, [r for r in regions if r["page"] == 1])
        with open(out_path, "wb") as out:
            _write_png(picture, out)
        return "image/png", 1
    document, form_env = _open_pdf(path)
    try:
        pages = []
        for index in range(len(document)):
            picture = _displayed_pdf_page(document, form_env, index)
            _burn(picture, [r for r in regions if r["page"] == index + 1])
            pages.append((picture.width, picture.height, zlib.compress(picture.tobytes(), 6)))
        with open(out_path, "wb") as out:
            _write_pdf(pages, out)
        return "application/pdf", len(pages)
    finally:
        document.close()


def _rotated(page: Any) -> Callable[[float, float], tuple[float, float]]:
    """Page-space point to displayed fractions, honouring /Rotate and the visible area."""
    left, bottom, right, top = page.get_bbox()
    span_x, span_y = right - left, top - bottom
    rotation = page.get_rotation() % 360

    def place(x: float, y: float) -> tuple[float, float]:
        across, up = (x - left) / span_x, (y - bottom) / span_y
        if rotation == 90:
            return up, across
        if rotation == 180:
            return 1 - across, up
        if rotation == 270:
            return 1 - up, 1 - across
        return across, 1 - up

    return place


def _clean(value: float) -> float:
    return round(value, 6)


def _box_thousandths(boxes: list[tuple[float, float, float, float]], place: Callable) -> dict[str, int] | None:
    corners = [place(x, y) for left, bottom, right, top in boxes for x, y in ((left, bottom), (right, top))]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    low_x, high_x = max(min(xs), 0.0), min(max(xs), 1.0)
    low_y, high_y = max(min(ys), 0.0), min(max(ys), 1.0)
    if low_x >= high_x or low_y >= high_y:
        return None
    x, y = math.floor(_clean(low_x * 1000)), math.floor(_clean(low_y * 1000))
    return {
        "x": x,
        "y": y,
        "w": math.ceil(_clean(high_x * 1000)) - x,
        "h": math.ceil(_clean(high_y * 1000)) - y,
    }


def _visible(box: tuple[float, float, float, float], bounds: tuple[float, float, float, float]) -> bool:
    return box[0] < bounds[2] and box[2] > bounds[0] and box[1] < bounds[3] and box[3] > bounds[1]


def _page_matches(page: Any, number: int, words: list[str]) -> list[dict[str, int]]:
    text_page = page.get_textpage()
    try:
        count = text_page.count_chars()
        bounds = page.get_bbox()
        place = _rotated(page)
        stream: list[tuple[str, int]] = []
        previous_space = True
        for index in range(count):
            char = text_page.get_text_range(index, 1, errors="ignore") or "�"
            if char.isspace() or char == "\x00":
                if not previous_space:
                    stream.append((" ", index))
                previous_space = True
                continue
            box = text_page.get_charbox(index)
            if not _visible(box, bounds):
                if not previous_space:
                    stream.append((" ", index))
                previous_space = True
                continue
            previous_space = False
            stream.extend((folded, index) for folded in char.lower())
        haystack = "".join(item[0] for item in stream)
        pattern = re.compile(r"\s+".join(re.escape(word) for word in words))
        found: list[dict[str, int]] = []
        for match in pattern.finditer(haystack):
            lines: list[list[tuple[float, float, float, float]]] = []
            for position in range(match.start(), match.end()):
                folded, index = stream[position]
                if folded == " ":
                    continue
                box = text_page.get_charbox(index)
                centre = (box[1] + box[3]) / 2
                height = max(box[3] - box[1], 1e-6)
                if lines and abs(centre - (lines[-1][-1][1] + lines[-1][-1][3]) / 2) <= height / 2:
                    lines[-1].append(box)
                else:
                    lines.append([box])
            for line in lines:
                region = _box_thousandths(line, place)
                if region:
                    found.append({"page": number, **region})
        return found
    finally:
        text_page.close()


def find_text(path: str, text: str) -> list[dict[str, int]]:
    """Regions for a searched text: page order, then top to bottom, then left to right."""
    words = text.lower().split()
    document = pypdfium2.PdfDocument(path)
    try:
        results: list[dict[str, int]] = []
        for index in range(len(document)):
            page = document[index]
            try:
                results.extend(sorted(_page_matches(page, index + 1, words), key=lambda r: (r["y"], r["x"])))
            finally:
                page.close()
        return results
    finally:
        document.close()


class RenderPool:
    """Worker processes, spawned on first use. A crashed worker is replaced on the next job."""

    def __init__(self) -> None:
        self._pool: ProcessPoolExecutor | None = None

    def _ensure(self) -> ProcessPoolExecutor:
        if self._pool is None:
            self._pool = ProcessPoolExecutor(max_workers=2, mp_context=get_context("spawn"))
        return self._pool

    async def run(self, function: Callable, *args: Any) -> Any:
        try:
            return await asyncio.get_running_loop().run_in_executor(self._ensure(), partial(function, *args))
        except BrokenProcessPool:
            self._pool = None
            raise


POOL = RenderPool()
