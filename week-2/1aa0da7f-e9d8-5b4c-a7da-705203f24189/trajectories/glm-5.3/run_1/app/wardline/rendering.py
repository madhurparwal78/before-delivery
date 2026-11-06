"""Rendering and redaction (DP-40, DP-44, DP-45, DP-46).

PNG and PDF derivatives are byte-identical on every render from the same
original and saved marks. Rendering reads only as much of the file as the
page count and the render limits need.
"""
from __future__ import annotations

import datetime
import io
import struct
import zlib
from dataclasses import dataclass
from typing import Any

MAX_PIXELS = 40_000_000
MAX_PDF_PAGES = 200
RENDER_DPI = 150


class NotRedactable(Exception):
    pass


class NotPreviewable(Exception):
    pass


@dataclass
class PageInfo:
    width: int
    height: int
    render: Any  # callable -> (bytes PNG, w, h) for image or page raster


class RenderInput:
    """A parsed exhibit file: enough to count pages, preview and render."""


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def _png_signature() -> bytes:
    return b"\x89PNG\r\n\x1a\n"


def _png_bytes(pixels: list[bytes], width: int, height: int) -> bytes:
    """Encode 8-bit RGB PNG with only IHDR, IDAT and IEND (byte-identical)."""
    raw = bytearray()
    stride = width * 3
    for row in pixels:
        raw.append(0)
        raw.extend(row[:stride])
    compressed = zlib.compress(bytes(raw), 6)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    out = bytearray(_png_signature())
    out += _png_chunk(b"IHDR", ihdr)
    out += _png_chunk(b"IDAT", compressed)
    out += _png_chunk(b"IEND", b"")
    return bytes(out)


def _fill_bounds(start: int, end: int, size: int) -> tuple[int, int]:
    """Region thousandths -> pixel range, rounding the fill outward."""
    lo = (start * size) // 1000
    hi = -((-end * size) // 1000)
    return max(0, lo), min(size, hi)


def fill_regions(pixels: list[bytes], width: int, height: int, page: int, regions: list[dict]) -> None:
    """Burn regions into an RGB pixel buffer (exact black)."""
    for r in regions:
        if r.get("page") != page:
            continue
        x0, x1 = _fill_bounds(r["x"], r["x"] + r["w"], width)
        y0, y1 = _fill_bounds(r["y"], r["y"] + r["h"], height)
        for y in range(y0, y1):
            row = pixels[y]
            for x in range(x0, x1):
                i = x * 3
                row[i] = 0
                row[i + 1] = 0
                row[i + 2] = 0


class ImagePages:
    """Single-page image input, EXIF orientation 1-8 applied."""

    def __init__(self, data: bytes, sniffed_type: str):
        from PIL import Image, ImageOps

        self.image = Image.open(io.BytesIO(data))
        if self.image.format not in ("PNG", "JPEG"):
            raise NotRedactable()
        self.image.load()
        self.oriented = ImageOps.exif_transpose(self.image)
        if self.oriented.mode not in ("RGB", "L", "P", "RGBA", "LA", "CMYK", "I;16", "I", "1"):
            raise NotRedactable()
        if self.oriented.width * self.oriented.height > MAX_PIXELS:
            raise NotPreviewable()
        if self.image.format == "PNG" and getattr(self.image, "is_animated", False) or getattr(self.image, "n_frames", 1) > 1:
            pass  # first frame only, PIL already gives the first
        base = self.oriented.convert("RGB")
        self.rgb = base
        self.width = base.width
        self.height = base.height
        self.page_count = 1

    def raster(self, page: int, regions: list[dict] | None) -> bytes:
        width, height = self.width, self.height
        pixels = [bytearray(base) for base in self._rows(width, height)]
        if regions:
            fill_regions(pixels, width, height, 1, regions)
        return _png_bytes([bytes(r) for r in pixels], width, height)

    def _rows(self, width: int, height: int) -> list[bytes]:
        buf = self.rgb.tobytes()
        stride = width * 3
        return [buf[y * stride:(y + 1) * stride] for y in range(height)]

    def matches(self, text: str) -> list[dict]:
        return []  # images hold no text layer


class PdfPages:
    """PDF input: visible text geometry through the pypdf text layer."""

    def __init__(self, data: bytes):
        import pypdf

        self.reader: Any = None
        try:
            self.reader = pypdf.PdfReader(io.BytesIO(data))
            if self.reader.is_encrypted:
                self.reader = None
                raise NotPreviewable()
        except NotPreviewable:
            raise
        except Exception:
            self.reader = None
            raise NotRedactable()
        try:
            self.page_count = len(self.reader.pages)
        except Exception:
            raise NotRedactable()
        if self.page_count > MAX_PDF_PAGES:
            raise NotPreviewable()
        for page in self.reader.pages:
            try:
                box = page.mediabox
                w = float(box.width)
                h = float(box.height)
            except Exception:
                raise NotRedactable()
            if w * (RENDER_DPI / 72.0) * h * (RENDER_DPI / 72.0) > MAX_PIXELS:
                raise NotPreviewable()

    def _displayed_size(self, page: Any) -> tuple[int, int]:
        crop = page.cropbox
        rotate = page.rotation or 0
        w = float(crop.width)
        h = float(crop.height)
        if (rotate % 360) in (90, 270):
            w, h = h, w
        dw = int(-(-(w * RENDER_DPI) // 72))
        dh = int(-(-(h * RENDER_DPI) // 72))
        return max(1, dw), max(1, dh)

    def raster(self, page_no: int, regions: list[dict] | None) -> bytes:
        """Rasterise one page: draw visible text runs into an RGB buffer."""
        import pypdf
        from pypdf.generic import RectangleObject

        page = self.reader.pages[page_no - 1]
        dw, dh = self._displayed_size(page)
        pixels = [bytearray(b"\xff" * (dw * 3)) for _ in range(dh)]
        crop = RectangleObject([float(v) for v in page.cropbox])
        rotate = page.rotation or 0
        try:
            runs = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            runs = ""
        if runs:
            self._paint_runs(page, pixels, dw, dh, crop, rotate)
        else:
            try:
                self._paint_runs(page, pixels, dw, dh, crop, rotate)
            except Exception:
                pass
        if regions:
            fill_regions(pixels, dw, dh, page_no, regions)
        return _png_bytes([bytes(r) for r in pixels], dw, dh)

    def _paint_runs(self, page: Any, pixels: list[bytearray], dw: int, dh: int, crop, rotate: int) -> None:
        """Place each glyph run from the text layer into the raster."""
        try:
            visitor = _RunCollector()
            page.extract_text(extraction_mode="plain", visitor_operand_before=visitor.before, visitor_operand_after=visitor.after)
            runs = visitor.runs
        except Exception:
            runs = []
        if not runs:
            return
        sx = dw / float(crop.width if (rotate % 360) not in (90, 270) else crop.height)
        sy = dh / float(crop.height if (rotate % 360) not in (90, 270) else crop.width)
        for tm, text, font_size in runs:
            if not text.strip():
                continue
            self._draw_run(pixels, dw, dh, tm, text, font_size, sx, sy, crop, rotate)

    def _draw_run(self, pixels, dw, dh, tm, text, font_size, sx, sy, crop, rotate) -> None:
        """Draw one text run as solid black marks using per-character advances."""
        base_x = (tm[4] - float(crop.left)) * sx
        base_y = (float(crop.top) - tm[5]) * sy
        est_char_w = max(1.0, font_size * sx * 0.55)
        est_h = max(2, int(font_size * sy * 0.75))
        x = base_x
        for ch in text:
            if ch.strip():
                self._paint_glyph(pixels, dw, dh, x, base_y, est_char_w, est_h)
            x += est_char_w

    def _paint_glyph(self, pixels, dw, dh, x, y, w, h) -> None:
        x0 = max(0, int(x))
        x1 = min(dw, int(x + w) + 1)
        y0 = max(0, int(y))
        y1 = min(dh, int(y + h) + 1)
        for py in range(y0, y1):
            row = pixels[py]
            for px in range(x0, x1):
                i = px * 3
                row[i] = 0
                row[i + 1] = 0
                row[i + 2] = 0

    def matches(self, text: str) -> list[dict]:
        import pypdf

        wanted = " ".join(text.split()).casefold()
        if not wanted:
            return []
        out: list[dict] = []
        for idx, page in enumerate(self.reader.pages):
            runs = []
            try:
                collector = _RunCollector()
                page.extract_text(extraction_mode="plain", visitor_operand_before=collector.before, visitor_operand_after=collector.after)
                runs = collector.runs
            except Exception:
                continue
            dw, dh = self._displayed_size(page)
            crop = page.cropbox
            rotate = page.rotation or 0
            sx = dw / float(crop.width if (rotate % 360) not in (90, 270) else crop.height)
            sy = dh / float(crop.height if (rotate % 360) not in (90, 270) else crop.width)
            joined = "".join(t for _, t, _ in runs)
            norm = " ".join(joined.split())
            if wanted not in norm.casefold():
                continue
            # locate each occurrence on the page, run by run
            tokens = [t for _, t, _ in runs if t]
            est_w = {}
            for i, (tm, t, fs) in enumerate(runs):
                if not t:
                    continue
                char_w = max(1.0, fs * sx * 0.55)
                est_w[i] = char_w
            # simple scan: find runs whose text contains the wanted substring pieces
            for i, (tm, t, fs) in enumerate(runs):
                t_clean = t.strip()
                if not t_clean:
                    continue
                if wanted.casefold() in " ".join(t_clean.split()).casefold():
                    x = (tm[4] - float(crop.left)) * sx
                    y = (float(crop.top) - tm[5]) * sy
                    w_pix = int(est_w[i] * len(t_clean)) + 2
                    h_pix = max(2, int(fs * sy * 0.75)) + 2
                    x0 = max(0.0, x)
                    x1 = min(float(dw), x + w_pix)
                    y0 = max(0.0, y)
                    y1 = min(float(dh), y + h_pix)
                    if x1 > x0 and y1 > y0:
                        out.append(self._region(idx + 1, x0, y0, x1, y1, dw, dh))
        return out

    def _region(self, page: int, x0: float, y0: float, x1: float, y1: float, dw: int, dh: int) -> dict:
        def thou(v: float, total: int) -> int:
            return max(0, min(1000, int(v * 1000 / total)))
        tx0 = thou(x0, dw)
        tx1 = thou(x1, dw)
        ty0 = thou(y0, dh)
        ty1 = thou(y1, dh)
        if tx1 <= tx0:
            tx1 = min(1000, tx0 + 1)
        if ty1 <= ty0:
            ty1 = min(1000, ty0 + 1)
        return {"page": page, "x": tx0, "y": ty0, "w": tx1 - tx0, "h": ty1 - ty0}


class _RunCollector:
    """Collects text-position runs from pypdf's visitor callbacks."""

    def __init__(self):
        self.runs: list[tuple[list[float], str, float]] = []

    def before(self, text: Any, cm: Any, tm: Any, font_dict: Any, font_size: float) -> None:
        if text:
            self.runs.append((list(tm), text, float(font_size or 8.0)))

    def after(self, text: Any, cm: Any, tm: Any, font_dict: Any, font_size: float) -> None:
        pass


def parse(data: bytes, sniffed_type: str) -> ImagePages | PdfPages | None:
    """Parse a sealed file. Returns None for audio; raises for bad files."""
    if sniffed_type in ("audio/wav", "audio/mpeg"):
        return None
    if sniffed_type in ("image/png", "image/jpeg"):
        return ImagePages(data, sniffed_type)
    if sniffed_type == "application/pdf":
        return PdfPages(data)
    return None


def _png_decode(png: bytes) -> tuple[list[bytes], int, int]:
    """Decode one of our own RGB PNGs back to rows + size."""
    from PIL import Image

    image = Image.open(io.BytesIO(png)).convert("RGB")
    width, height = image.size
    buf = image.tobytes()
    stride = width * 3
    return [buf[y * stride:(y + 1) * stride] for y in range(height)], width, height


_PDF_FIXED_EPOCH = (1970, 1, 1)


def pdf_from_pngs(pages: list[tuple[bytes, int, int]]) -> bytes:
    """One lossless RGB image per page; no dates, ids or extra objects."""
    import zlib

    objects: list[bytes] = []

    def stream(dict_items: list[tuple[str, Any]], data: bytes | None) -> bytes:
        pairs = " ".join(f"/{k} {v}" for k, v in dict_items)
        if data is None:
            return f"<< {pairs} >>".encode()
        return f"<< {pairs} /Length {len(data)} >>\nstream\n".encode() + data + b"\nendstream"

    kids_ids = []
    image_ids: list[int] = []
    page_ids: list[int] = []

    catalog_id = 1
    pages_id = 2
    object_count = 2

    page_objs = []
    for png, width, height in pages:
        rows, _, _ = _png_decode(png)
        raw = bytearray()
        for row in rows:
            raw.append(0)
            raw.extend(row)
        compressed = zlib.compress(bytes(raw), 6)
        object_count += 1
        image_id = object_count
        image_ids.append(image_id)
        object_count += 1
        page_id = object_count
        page_ids.append(page_id)
        page_objs.append((image_id, page_id, width, height, compressed))

    for image_id, page_id, width, height, compressed in page_objs:
        objects.append(
            (
                image_id,
                stream(
                    [
                        ("Type", "/XObject"),
                        ("Subtype", "/Image"),
                        ("Width", str(width)),
                        ("Height", str(height)),
                        ("ColorSpace", "/DeviceRGB"),
                        ("BitsPerComponent", "8"),
                        ("Filter", "/FlateDecode"),
                    ],
                    compressed,
                ),
            )
        )

    for image_id, page_id, width, height, compressed in page_objs:
        content = f"q {width} 0 0 {height} 0 0 cm /Im{image_id} Do Q".encode()
        object_count += 1
        content_id = object_count
        objects.append((content_id, stream([], content)))
        page_dict = (
            f"<< /Type /Page /Parent {pages_id} 0 R "
            f"/MediaBox [0 0 {width} {height}] "
            f"/Resources << /XObject << /Im{image_id} {image_id} 0 R >> >> "
            f"/Contents {content_id} 0 R >>"
        ).encode()
        objects.append((page_id, page_dict))

    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append((pages_id, f"<< /Type /Pages /Kids [{kids}] /Count {len(page_ids)} >>".encode()))
    objects.append((catalog_id, f"<< /Type /Catalog /Pages {pages_id} 0 R >>".encode()))

    objects.sort(key=lambda item: item[0])
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets: dict[int, int] = {}
    for oid, body in objects:
        offsets[oid] = len(out)
        out += f"{oid} 0 obj\n".encode()
        out += body
        out += b"\nendobj\n"
    xref_at = len(out)
    max_id = max(offsets)
    out += f"xref\n0 {max_id + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for oid in range(1, max_id + 1):
        off = offsets[oid]
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {max_id + 1} /Root {catalog_id} 0 R >>\n"
        f"startxref\n{xref_at}\n%%EOF\n"
    ).encode()
    return bytes(out)
