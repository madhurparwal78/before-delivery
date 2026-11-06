"""Content sniffing, displayed-page geometry, previews, find-text and rendering."""

from __future__ import annotations

import ctypes
import io
import math
import zlib
from dataclasses import dataclass

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = None

ACCEPTED_TYPES = (
    "application/pdf",
    "image/png",
    "image/jpeg",
    "audio/wav",
    "audio/mpeg",
)
IMAGE_TYPES = ("image/png", "image/jpeg")
AUDIO_TYPES = ("audio/wav", "audio/mpeg")

MAX_PIXELS = 40_000_000
MAX_PAGES = 200
PDF_SCALE = 150 / 72


class NotRenderable(Exception):
    """Audio, an unreadable file or one over the render limits."""


@dataclass(frozen=True)
class Inspection:
    page_count: int | None
    renderable: bool


def sniff(head: bytes) -> str | None:
    if head.startswith(b"%PDF"):
        return "application/pdf"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"RIFF") and head[8:12] == b"WAVE":
        return "audio/wav"
    if head.startswith(b"ID3"):
        return "audio/mpeg"
    if len(head) >= 2 and head[0] == 0xFF and (head[1] & 0xE0) == 0xE0:
        return "audio/mpeg"
    return None


def safe_file_name(name: str) -> bool:
    if not name or name in (".", ".."):
        return False
    if "/" in name or "\\" in name or ".." in name:
        return False
    return all(ord(ch) >= 0x20 and ord(ch) != 0x7F for ch in name)


def _open_pdf(data: bytes) -> pdfium.PdfDocument:
    return pdfium.PdfDocument(data)


def _scaled(points: float) -> int:
    """The displayed size in pixels; pdfium's page size carries float32 noise."""
    return math.ceil(points * PDF_SCALE - 1e-3)


def inspect(data: bytes, sniffed: str) -> Inspection:
    if sniffed in AUDIO_TYPES:
        return Inspection(None, False)
    if sniffed in IMAGE_TYPES:
        try:
            with Image.open(io.BytesIO(data)) as image:
                width, height = image.size
                if image.getexif().get(274, 1) in (5, 6, 7, 8):
                    width, height = height, width
        except (OSError, ValueError, Image.DecompressionBombError):
            return Inspection(None, False)
        return Inspection(1, width * height <= MAX_PIXELS)
    try:
        document = _open_pdf(data)
        pages = len(document)
        renderable = pages <= MAX_PAGES
        if renderable:
            for index in range(pages):
                page = document[index]
                width = _scaled(page.get_width())
                height = _scaled(page.get_height())
                if width * height > MAX_PIXELS:
                    renderable = False
                    break
        document.close()
    except pdfium.PdfiumError:
        return Inspection(None, False)
    return Inspection(pages, renderable)


def _image_of_page(data: bytes, sniffed: str, page: int) -> Image.Image:
    """The page exactly as a reader sees it."""
    if sniffed in IMAGE_TYPES:
        with Image.open(io.BytesIO(data)) as raw:
            image = ImageOps.exif_transpose(raw)
            if image.mode in ("RGBA", "LA", "PA") or (
                image.mode == "P" and "transparency" in image.info
            ):
                image = image.convert("RGBA")
                flat = Image.new("RGB", image.size, (255, 255, 255))
                flat.paste(image, mask=image.split()[-1])
                return flat
            return image.convert("RGB")
    document = _open_pdf(data)
    try:
        pdf_page = document[page - 1]
        bitmap = pdf_page.render(scale=PDF_SCALE, draw_annots=True, may_draw_forms=True)
        image = bitmap.to_pil().convert("RGB")
        wanted = (_scaled(pdf_page.get_width()), _scaled(pdf_page.get_height()))
        if image.size != wanted:
            image = image.crop((0, 0, wanted[0], wanted[1])) if (
                image.width >= wanted[0] and image.height >= wanted[1]
            ) else image.resize(wanted)
        return image
    finally:
        document.close()


def displayed_size(data: bytes, sniffed: str, page: int) -> tuple[int, int]:
    if sniffed in IMAGE_TYPES:
        with Image.open(io.BytesIO(data)) as raw:
            width, height = raw.size
            if raw.getexif().get(274, 1) in (5, 6, 7, 8):
                width, height = height, width
        return width, height
    document = _open_pdf(data)
    try:
        pdf_page = document[page - 1]
        return _scaled(pdf_page.get_width()), _scaled(pdf_page.get_height())
    finally:
        document.close()


def _burn(image: Image.Image, regions: list[dict]) -> None:
    width, height = image.size
    for region in regions:
        left = (region["x"] * width) // 1000
        right = -((-(region["x"] + region["w"]) * width) // 1000)
        top = (region["y"] * height) // 1000
        bottom = -((-(region["y"] + region["h"]) * height) // 1000)
        left = max(0, min(width, left))
        right = max(0, min(width, right))
        top = max(0, min(height, top))
        bottom = max(0, min(height, bottom))
        if right > left and bottom > top:
            image.paste((0, 0, 0), (left, top, right, bottom))


def write_png(image: Image.Image) -> bytes:
    """A PNG holding only IHDR, IDAT and IEND."""
    width, height = image.size
    pixels = image.tobytes()
    stride = width * 3
    raw = bytearray()
    for row in range(height):
        raw.append(0)
        raw.extend(pixels[row * stride : (row + 1) * stride])
    out = bytearray(b"\x89PNG\r\n\x1a\n")

    def chunk(kind: bytes, payload: bytes) -> None:
        out.extend(len(payload).to_bytes(4, "big"))
        out.extend(kind)
        out.extend(payload)
        out.extend(zlib.crc32(kind + payload).to_bytes(4, "big"))

    header = (
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + bytes([8, 2, 0, 0, 0])
    )
    chunk(b"IHDR", header)
    chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    chunk(b"IEND", b"")
    return bytes(out)


def write_pdf(pages: list[Image.Image]) -> bytes:
    """A PDF holding only the catalog, page tree, pages, contents and page images."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    add(b"")  # catalog placeholder, object 1
    add(b"")  # page tree placeholder, object 2
    page_ids: list[int] = []
    for image in pages:
        width, height = image.size
        data = zlib.compress(image.tobytes(), 9)
        image_id = add(
            b"<< /Type /XObject /Subtype /Image /Width "
            + str(width).encode()
            + b" /Height "
            + str(height).encode()
            + b" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode"
            b" /Length "
            + str(len(data)).encode()
            + b" >>\nstream\n"
            + data
            + b"\nendstream"
        )
        page_width = width * 72 / 150
        page_height = height * 72 / 150
        content = (
            b"q\n"
            + f"{page_width:.2f} 0 0 {page_height:.2f} 0 0 cm\n".encode()
            + b"/Im0 Do\nQ\n"
        )
        content_id = add(
            b"<< /Length "
            + str(len(content)).encode()
            + b" >>\nstream\n"
            + content
            + b"endstream"
        )
        page_id = add(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "
            + f"{page_width:.2f} {page_height:.2f}".encode()
            + b"] /Resources << /XObject << /Im0 "
            + str(image_id).encode()
            + b" 0 R >> >> /Contents "
            + str(content_id).encode()
            + b" 0 R >>"
        )
        page_ids.append(page_id)
    kids = b" ".join(f"{pid} 0 R".encode() for pid in page_ids)
    objects[1] = (
        b"<< /Type /Pages /Count "
        + str(len(page_ids)).encode()
        + b" /Kids ["
        + kids
        + b"] >>"
    )
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"

    out = bytearray(b"%PDF-1.7\n")
    offsets: list[int] = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out.extend(f"{index} 0 obj\n".encode())
        out.extend(body)
        out.extend(b"\nendobj\n")
    xref_at = len(out)
    out.extend(f"xref\n0 {len(objects) + 1}\n".encode())
    out.extend(b"0000000000 65535 f \n")
    for offset in offsets:
        out.extend(f"{offset:010d} 00000 n \n".encode())
    out.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_at}\n".encode()
    )
    out.extend(b"%%EOF\n")
    return bytes(out)


def render_preview(data: bytes, sniffed: str, page: int) -> bytes:
    if sniffed in AUDIO_TYPES:
        raise NotRenderable()
    image = _image_of_page(data, sniffed, page)
    return write_png(image)


def render_derivative(
    data: bytes, sniffed: str, page_count: int, regions: list[dict]
) -> tuple[bytes, str]:
    if sniffed in AUDIO_TYPES:
        raise NotRenderable()
    if sniffed in IMAGE_TYPES:
        image = _image_of_page(data, sniffed, 1)
        _burn(image, [r for r in regions if r["page"] == 1])
        return write_png(image), "image/png"
    pages = []
    for number in range(1, page_count + 1):
        image = _image_of_page(data, sniffed, number)
        _burn(image, [r for r in regions if r["page"] == number])
        pages.append(image)
    return write_pdf(pages), "application/pdf"


def _normalise(text: str) -> tuple[str, list[int]]:
    """Lower-cases and collapses white-space runs, keeping a map back to indexes."""
    out: list[str] = []
    index_map: list[int] = []
    previous_space = False
    for index, ch in enumerate(text):
        if ch.isspace():
            if not previous_space:
                out.append(" ")
                index_map.append(index)
            previous_space = True
            continue
        previous_space = False
        out.append(ch.lower())
        index_map.append(index)
    return "".join(out), index_map


def find_text(data: bytes, sniffed: str, page_count: int, needle: str) -> list[dict]:
    if sniffed in AUDIO_TYPES:
        raise NotRenderable()
    if sniffed in IMAGE_TYPES:
        return []
    wanted, _ = _normalise(needle)
    if wanted.strip() == "":
        return []
    matches: list[dict] = []
    document = _open_pdf(data)
    try:
        for number in range(1, page_count + 1):
            page = document[number - 1]
            width = _scaled(page.get_width())
            height = _scaled(page.get_height())
            textpage = page.get_textpage()
            count = textpage.count_chars()
            if count == 0:
                continue
            text = textpage.get_text_range(0, count)
            flat, index_map = _normalise(text)
            found: list[dict] = []
            start = flat.find(wanted)
            while start != -1:
                indexes = index_map[start : start + len(wanted)]
                groups: dict[int, list[int]] = {}
                for char_index in range(indexes[0], indexes[-1] + 1):
                    line = text.count("\n", 0, char_index)
                    groups.setdefault(line, []).append(char_index)
                for line in sorted(groups):
                    box = _group_box(
                        page, textpage, groups[line], text, width, height
                    )
                    if box is not None:
                        found.append(box)
                start = flat.find(wanted, start + 1)
            found.sort(key=lambda box: (box["y"], box["x"]))
            for box in found:
                box["page"] = number
                if box not in matches:
                    matches.append(box)
            textpage.close()
    finally:
        document.close()
    return [
        {"page": box["page"], "x": box["x"], "y": box["y"], "w": box["w"], "h": box["h"]}
        for box in matches
    ]


def _page_to_device(page, width: int, height: int, x: float, y: float) -> tuple[float, float]:
    device_x = ctypes.c_int()
    device_y = ctypes.c_int()
    pdfium_raw.FPDF_PageToDevice(
        page.raw,
        0,
        0,
        width,
        height,
        0,
        ctypes.c_double(x),
        ctypes.c_double(y),
        ctypes.byref(device_x),
        ctypes.byref(device_y),
    )
    return float(device_x.value), float(device_y.value)


def _group_box(
    page, textpage, indexes: list[int], text: str, width: int, height: int
) -> dict | None:
    left = top = math.inf
    right = bottom = -math.inf
    for index in indexes:
        if index >= len(text) or text[index].isspace():
            continue
        try:
            box = textpage.get_charbox(index, loose=False)
        except pdfium.PdfiumError:
            continue
        if box is None:
            continue
        x0, y0, x1, y1 = box
        corners = [
            _page_to_device(page, width, height, x0, y0),
            _page_to_device(page, width, height, x1, y1),
            _page_to_device(page, width, height, x0, y1),
            _page_to_device(page, width, height, x1, y0),
        ]
        for device_x, device_y in corners:
            left = min(left, device_x)
            right = max(right, device_x)
            top = min(top, device_y)
            bottom = max(bottom, device_y)
    if left is math.inf or right <= left or bottom <= top:
        return None
    if right <= 0 or bottom <= 0 or left >= width or top >= height:
        return None
    left = max(0.0, left)
    top = max(0.0, top)
    right = min(float(width), right)
    bottom = min(float(height), bottom)
    x = math.floor(left * 1000 / width)
    y = math.floor(top * 1000 / height)
    x_end = math.ceil(right * 1000 / width)
    y_end = math.ceil(bottom * 1000 / height)
    x = max(0, min(1000, x))
    y = max(0, min(1000, y))
    x_end = max(x + 1, min(1000, x_end))
    y_end = max(y + 1, min(1000, y_end))
    return {"x": x, "y": y, "w": x_end - x, "h": y_end - y}
