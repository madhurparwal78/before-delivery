"""A minimal PDF writer: uncompressed text in a standard font, so every line of a
compliance pack can be found with a plain byte search."""

LINES_PER_PAGE = 58
FONT_SIZE = 9
LEADING = 12
LEFT = 36
TOP = 780


def _escape(text):
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _content_stream(lines):
    parts = ["BT", f"/F1 {FONT_SIZE} Tf", f"{LEADING} TL", f"1 0 0 1 {LEFT} {TOP} Tm"]
    for line in lines:
        parts.append(f"({_escape(line)}) Tj")
        parts.append("T*")
    parts.append("ET")
    return "\n".join(parts).encode("latin-1", "replace")


def render(lines):
    """Render text lines to a single PDF document."""
    pages = [lines[i:i + LINES_PER_PAGE] for i in range(0, max(len(lines), 1), LINES_PER_PAGE)]
    pages = pages or [[]]
    objects = {}
    page_count = len(pages)
    font_obj = 3 + 2 * page_count

    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(page_count))
    objects[1] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[2] = f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode()
    for index, page_lines in enumerate(pages):
        page_obj = 3 + 2 * index
        content_obj = page_obj + 1
        objects[page_obj] = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
            f"/Resources << /Font << /F1 {font_obj} 0 R >> >> "
            f"/Contents {content_obj} 0 R >>"
        ).encode()
        stream = _content_stream(page_lines)
        objects[content_obj] = (
            f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"
        )
    objects[font_obj] = (
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"
    )

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for number in sorted(objects):
        offsets[number] = len(out)
        out += f"{number} 0 obj\n".encode() + objects[number] + b"\nendobj\n"
    xref_at = len(out)
    total = max(objects) + 1
    out += f"xref\n0 {total}\n".encode()
    out += b"0000000000 65535 f \n"
    for number in range(1, total):
        out += f"{offsets[number]:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {total} /Root 1 0 R >>\nstartxref\n{xref_at}\n%%EOF\n".encode()
    return bytes(out)
