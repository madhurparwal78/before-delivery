"""The regulator CSV, the pack manifest and the pack PDF (brief: Regulator CSV, Services)."""

from . import clock, rules, views

COLUMNS = ["registration", "model", "msn", "directive", "revision", "title", "state", "governing_revision",
           "deadline_date", "fh_threshold", "governing", "inspector", "inspector_licence", "inspected_at",
           "certifier", "certifier_licence", "certified_at", "timeliness", "legacy_notes"]
OPERATOR = "Fenwick Regional Airways"
FORMULA_START = ("=", "+", "-", "@", "\t", "\r")
PERSON_COLUMNS = {"inspection": ("inspector", "inspector_licence"),
                  "countersignature": ("certifier", "certifier_licence")}


def csv_cell(value) -> str:
    """Neutralise a cell a spreadsheet could read as a formula, then quote it as RFC 4180 requires."""
    if value is None:
        return ""
    text = str(value)
    if not isinstance(value, int | float) and text.startswith(FORMULA_START):
        text = "'" + text
    return '"' + text.replace('"', '""') + '"' if any(c in text for c in '",\r\n') else text


def csv_bytes(rows: list[list]) -> bytes:
    return "".join(",".join(csv_cell(v) for v in row) + "\r\n" for row in [COLUMNS, *rows]).encode("utf-8")


async def regulator_rows(conn, fleet: views.Fleet, directive_id: str) -> tuple[list[list], list[list]]:
    """One row per thread of the directive by registration, plus references [row, column, user id] to every
    cell that names a person, so an erasure can re-render the same rows."""
    d = fleet.directives[directive_id]
    threads = await conn.fetch("SELECT * FROM threads WHERE directive_id = $1 ORDER BY registration", directive_id)
    signed: dict[str, dict] = {}
    for s in await conn.fetch("SELECT * FROM signatures WHERE status = 'valid' AND thread_id = ANY($1) ORDER BY seq",
                              [t["id"] for t in threads]):
        signed.setdefault(s["thread_id"], {})[s["signs_as"]] = s
    notes: dict[str, list] = {}
    for r in await conn.fetch("SELECT thread_id, notes FROM legacy_records WHERE thread_id = ANY($1) AND notes <> ''"
                              " ORDER BY seq", [t["id"] for t in threads]):
        notes.setdefault(r["thread_id"], []).append(r["notes"])
    rows, refs = [], []
    for i, t in enumerate(threads):
        s = views.status(fleet, t)
        tail = fleet.tails[t["registration"]]
        live = s["stage"] not in rules.UNCOUNTED
        values = dict.fromkeys(COLUMNS)
        values.update(
            registration=t["registration"], model=tail.model, msn=tail.msn, directive=views.directive_name(d),
            revision=rules.tag(d["current_revision"]), title=views.wording(fleet, t)["title"], state=s["state"],
            governing_revision=rules.tag(t["rule_revision"]),
            deadline_date=s["limits"]["deadline_date"] if live else None,
            fh_threshold=s["limits"]["fh_threshold"] if live else None, governing=s["governing"],
            timeliness=t["timeliness"], legacy_notes="; ".join(notes.get(t["id"], [])) or None)
        for role, (name_col, licence_col) in PERSON_COLUMNS.items():
            sig = signed.get(t["id"], {}).get(role)
            if sig is None:
                continue
            values["inspected_at" if role == "inspection" else "certified_at"] = clock.iso(sig["committed_at"])
            if sig["signer_id"]:
                who = fleet.people[sig["signer_id"]]
                values[name_col], values[licence_col] = who["display_name"], who["licence"]
                refs.append([i, COLUMNS.index(name_col), who["id"]])
                refs.append([i, COLUMNS.index(licence_col), who["id"]])
            else:
                values[name_col], values[licence_col] = sig["signer_text"], sig["licence_text"]
        rows.append([values[c] for c in COLUMNS])
    return rows, refs


def _pdf_text(value: str) -> bytes:
    clean = "".join(" " if ord(c) < 32 else c for c in value)
    raw = clean.encode("cp1252", errors="replace")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def _wrap(fields: list[str], width: int = 150) -> list[str]:
    """Join fields with separators, breaking only between fields so names stay searchable."""
    lines, line = [], ""
    for f in fields:
        piece = f if not line else " | " + f
        if line and len(line) + len(piece) > width:
            lines.append(line)
            line, piece = "    " + f, ""
        line += piece
    return [*lines, line] if line else lines


def pdf_bytes(snapshot: dict) -> bytes:
    """A plain PDF in Helvetica with uncompressed text: the directive, revision, operator, time and rows."""
    lines = [("F2", 13, "Compliance pack"),
             ("F1", 9, f"Operator: {OPERATOR}"),
             ("F1", 9, f"Directive: {snapshot['directive']} {snapshot['revision']}"),
             ("F1", 9, f"Title: {snapshot['title']}"),
             ("F1", 9, f"Generated: {snapshot['generated_at']}"),
             ("F1", 9, f"Threads: {len(snapshot['rows'])}"),
             ("F1", 9, ""),
             ("F2", 7, " | ".join(COLUMNS))]
    for row in snapshot["rows"]:
        for text in _wrap(["" if v is None else str(v) for v in row]):
            lines.append(("F1", 7, text))
    pages, page, y = [], [], 560
    for font, size, text in lines:
        if y < 40:
            pages.append(page)
            page, y = [], 560
        page.append(b"BT /%s %d Tf 36 %d Td (%s) Tj ET" % (font.encode(), size, y, _pdf_text(text)))
        y -= size + 4
    pages.append(page)

    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    kids = []
    fonts = b"<< /F1 3 0 R /F2 4 0 R >>"
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    for content in pages:
        stream = b"\n".join(content)
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream))
        objects.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /Font %s >> "
                       b"/Contents %d 0 R >>" % (fonts, len(objects)))
        kids.append(len(objects))
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % k for k in kids), len(kids))
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for n, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (n, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)
