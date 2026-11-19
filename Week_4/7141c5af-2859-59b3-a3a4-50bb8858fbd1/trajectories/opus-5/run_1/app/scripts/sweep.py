#!/usr/bin/env python3
"""The remaining published rules: mail, file limits, the workbook, the
materials list file and the dossier's contents. Verification only."""
import hashlib
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import http.cookiejar
import zlib

PRIMARY = "http://127.0.0.1:4173"
SHORT = "http://127.0.0.1:4184"
MAILPIT = os.environ.get("MAILPIT_URL", "http://mailpit:8025")

passed = 0
failed = []


def check(label, got, want):
    global passed
    if got == want:
        passed += 1
        print(f"ok   {label}")
    else:
        failed.append(label)
        print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")


class Desk:
    def __init__(self, base):
        self.base = base
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, raw=None, ctype="application/json", headers=None):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", ctype)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with self.opener.open(req, timeout=120) as r:
                text = r.read()
                ct = r.headers.get("content-type", "")
                return r.status, (json.loads(text) if text and "json" in ct else text), dict(r.headers)
        except urllib.error.HTTPError as e:
            text = e.read()
            try:
                return e.code, json.loads(text), dict(e.headers)
            except Exception:
                return e.code, text, dict(e.headers)

    def sign_in(self):
        return self.call(
            "POST", "/api/session",
            {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"},
        )


def msg(body):
    return body.get("error", {}).get("message") if isinstance(body, dict) else None


def mailpit(path):
    with urllib.request.urlopen(f"{MAILPIT}{path}", timeout=30) as r:
        return json.loads(r.read())


def clear_mail():
    req = urllib.request.Request(f"{MAILPIT}/api/v1/messages", method="DELETE")
    urllib.request.urlopen(req, timeout=30).read()


def wait_for_mail(count, seconds=30):
    for _ in range(seconds * 2):
        box = mailpit("/api/v1/messages")
        if box.get("messages_count", box.get("total", 0)) >= count:
            return box
        time.sleep(0.5)
    return mailpit("/api/v1/messages")


# Each run makes its own files, so a repeat is a real repeat and not an
# artefact of running twice.
NONCE = os.environ.get("SWEEP_NONCE", str(int(time.time())))


def luhn(prefix7):
    """An eight-digit stamp number ending in its Luhn check digit."""
    for candidate in (prefix7 + str(d) for d in range(10)):
        total = 0
        for i in range(8):
            digit = int(candidate[7 - i])
            if i % 2 == 0:
                total += digit
            else:
                digit *= 2
                total += digit - 9 if digit > 9 else digit
        if total % 10 == 0:
            return candidate
    raise AssertionError("no check digit")


# A stamp number is unique on a desk, so each run needs its own.
STAMPS = [luhn(f"{(int(NONCE) % 1000000) + n:06d}" + str(n)) for n in range(4)]


def header_of(headers, name):
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


def png(width=1, height=1, pad=0):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    rows = b"".join(b"\x00" + bytes([(x * 7) % 256 for x in range(width)]) for _ in range(height))
    out = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows, 1))
    out += chunk(b"tEXt", b"run\x00" + NONCE.encode())
    if pad:
        out += chunk(b"tEXt", b"pad\x00" + b"x" * pad)
    return out + chunk(b"IEND", b"")


def multipart(parts, boundary="SweepB"):
    body = b""
    for part in parts:
        body += f"--{boundary}\r\n".encode()
        if "filename" in part:
            body += (
                f'Content-Disposition: form-data; name="{part["name"]}"; filename="{part["filename"]}"\r\n'
                f'Content-Type: {part.get("type", "application/octet-stream")}\r\n\r\n'
            ).encode()
            body += part["bytes"]
        else:
            body += f'Content-Disposition: form-data; name="{part["name"]}"\r\n\r\n'.encode()
            body += part["value"].encode()
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


desk = Desk(PRIMARY)
desk.sign_in()

# -------------------------------------------------------- photograph limits
print("== photograph limits ==")
raw, ctype = multipart([{"name": "file", "filename": "a.png", "type": "image/png", "bytes": png(8, 8)},
                        {"name": "side", "value": "before"}])
s, b, _ = desk.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("a PNG is stored", (s, b["photograph"]["state"]), (201, "stored"))
stored_id = b["photograph"]["id"]
sent = png(8, 8)
check("bytes counted on the file alone", b["photograph"]["bytes"], len(sent))
check("sha256 is the file's own", b["photograph"]["sha256"], hashlib.sha256(sent).hexdigest())

s, got, _ = desk.call("GET", f"/api/pieces/1/photographs/{stored_id}/file")
check("kept byte for byte", got, sent)

s, b, _ = desk.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("the same file again reads F-26", s, 409)
check("F-26 names the photograph", msg(b).startswith("Already on this piece as photograph "), True)

svg = b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'
raw, ctype = multipart([{"name": "file", "filename": "a.png", "type": "image/png", "bytes": svg}])
s, b, _ = desk.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("an SVG is refused however it is named", (s, msg(b)), (422, "This file is not a PNG or JPEG."))

# a 7,990,000-byte file inside a bigger request is accepted
padded = png(64, 64, pad=7_990_000 - len(png(64, 64)) - 16)
check("the padded file is 7,990,000 bytes", len(padded), 7_990_000)
raw, ctype = multipart([
    {"name": "file", "filename": "big.png", "type": "image/png", "bytes": padded},
    {"name": "side", "value": "after"},
])
s, b, _ = desk.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("7,990,000 bytes in a bigger request is accepted", s, 201)

over = png(64, 64, pad=8_000_001 - len(png(64, 64)) - 16)
check("the oversize file is 8,000,001 bytes", len(over), 8_000_001)
raw, ctype = multipart([{"name": "file", "filename": "over.png", "type": "image/png", "bytes": over}])
s, b, _ = desk.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("8,000,001 bytes answers 413", s, 413)
check("413 reads F-25", msg(b), "This file is over 8,000,000 bytes.")

# 413 comes before authentication
anon = Desk(PRIMARY)
s, b, _ = anon.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("413 before authentication", s, 413)
check("413 is JSON", msg(b), "This file is over 8,000,000 bytes.")

# ------------------------------------------------------------ the workbook
print()
print("== the workbook ==")
header = "client,piece,maker,year,stamp,material,notes\r\n"
rows = (
    f'"Sweep Client {NONCE}","Chair one {NONCE}",Maker,1950,{STAMPS[0]},VM-2041,"first\nnote"\r\n'
    f'"Sweep Client {NONCE}","Chair two",Maker,1951,{STAMPS[0]},VM-2041,second\r\n'
    'Other,"Chair three",Maker,1952,99999991,,third\r\n'
    f'Other,,Maker,1953,{STAMPS[1]},,fourth\r\n'
    f'Other,"Chair five",Maker,1954,{STAMPS[2]},VM-9999,fifth\r\n'
    f'Other,"Chair six",Maker,1955,{STAMPS[3]},\r\n'
)
file_bytes = ("\ufeff" + header + rows).encode("utf-8")
raw, ctype = multipart([{"name": "file", "filename": "w.csv", "type": "text/csv", "bytes": file_bytes}])
s, b, _ = desk.call("POST", "/api/workbook/preview", raw=raw, ctype=ctype)
check("preview 200", s, 200)
numbers = [row["row"] for row in b["rows"]]
check("row numbers count records", numbers, [2, 3, 4, 5, 6, 7])
statuses = [row["status"] for row in b["rows"]]
check("a second row with the same stamp is matched", statuses[1], "matched")
reasons = {row["row"]: row["reason"] for row in b["rows"]}
check("bad stamp refused", reasons[4], "Row 4: that stamp number does not check out.")
check("no title refused", reasons[5], "Row 5: the piece has no title.")
check("unknown material refused", reasons[6], "Row 6: the desk has no material VM-9999.")
check("short row refused", reasons[7], "Row 7: that row does not have seven fields.")
check("a refused row never blocks the others", statuses[0], "new")
check("quoted line break kept in the field", b["rows"][0]["notes"], "first\nnote")

s, first, _ = desk.call("POST", "/api/workbook/save", raw=raw, ctype=ctype)
check("save 200", s, 200)
check("one new row", first["created"], 1)
check("the kept file's digest is the sent bytes'", first["sha256"], hashlib.sha256(file_bytes).hexdigest())
s, again, _ = desk.call("POST", "/api/workbook/save", raw=raw, ctype=ctype)
check("a second save changes nothing", again["created"], 0)

s, listing, _ = desk.call("GET", "/api/pieces?client=")
s, pieces, _ = desk.call("GET", f"/api/search?q=Chair%20one%20{NONCE}")
check("the new piece is findable", f"Chair one {NONCE}" in [hit["label"] for hit in pieces["results"]], True)

# --------------------------------------------------- the materials list file
print()
print("== the materials list file ==")
s, text, headers = desk.call("GET", "/api/materials-list.csv")
body = text if isinstance(text, str) else text.decode()
check("content type", header_of(headers, "content-type"), "text/csv; charset=utf-8")
lines = body.split("\r\n")
check("CRLF line ends", body.endswith("\r\n"), True)
check("header row", lines[0], '"piece","client","material","code","lot","hides","notes"')
check("every field quoted", all(line.startswith('"') and line.endswith('"') for line in lines if line), True)

desk.call("POST", "/api/clients", {"name": f"=Formula Client {NONCE}", "town": "Turin"})
s, clients, _ = desk.call("GET", "/api/clients")
guard_client = next(c for c in clients["clients"] if c["name"] == f"=Formula Client {NONCE}")
desk.call("POST", "/api/pieces", {"clientId": guard_client["id"], "title": "-Dash piece", "notes": "@at note"})
s, text, _ = desk.call("GET", "/api/materials-list.csv")
body = text if isinstance(text, str) else text.decode()
check("a cell starting with - carries the apostrophe", '"\'-Dash piece"' in body, True)
check("a cell starting with = carries the apostrophe", f'"\'=Formula Client {NONCE}"' in body, True)
check("a cell starting with @ carries the apostrophe", '"\'@at note"' in body, True)

# ----------------------------------------------------------------- the mail
print()
print("== the mail ==")
clear_mail()
s, b, _ = desk.call("POST", "/api/enquiries", {
    "name": "Mira\n\n\nHolt", "email": f"mira-{NONCE}@example.org",
    "message": "A cantilever chair with a loose joint."})
check("enquiry accepted", s, 202)
box = wait_for_mail(1)
letter = box["messages"][0]
check("enquiry reaches the conservator", letter["To"][0]["Address"], "agnese@bottega-semenza.example")
check("each run of line breaks reads as one space", letter["Subject"], "Enquiry from Mira Holt")
check("Reply-To is the visitor's address", letter["ReplyTo"][0]["Address"], f"mira-{NONCE}@example.org")

clear_mail()
# a Japanese client's page mail
s, page, _ = desk.call("POST", "/api/pieces/4/client-page", {})
address = page["clientPage"]["address"]
box = wait_for_mail(1)
letter = mailpit(f"/api/v1/message/{box['messages'][0]['ID']}")
check("to the client", letter["To"][0]["Address"], "aoi@clients.example")
check("subject M1 in Japanese", letter["Subject"], "Folding deck chair \u306e\u304a\u898b\u7a4d\u3082\u308a")
text = letter["Text"]
check("greeting M3 in Japanese", "\u4e2d\u6751 \u8475 \u69d8" in text, True)
check("the address is in the body", address in text, True)
check("C19 in Japanese", "\u307e\u3067\u306b\u3054\u56de\u7b54\u304f\u3060\u3055\u3044\u3002" in text, True)
check("no labour rate in the mail", "85.00" not in text and "\u00a513,800" not in text, True)
for other in ["Giulia Ricci", "Harriet Osei", "Dana Whitlock", "Zo\u00eb \u00d8rsted"]:
    check(f"no other client's name ({other})", other not in text, True)

# one reminder, and only if no answer came
print("   waiting out REMINDER_AFTER_SECONDS=10 on the short copy")
short = Desk(SHORT)
short.sign_in()
clear_mail()
s, page, _ = short.call("POST", "/api/pieces/2/client-page", {})
box = wait_for_mail(1)
time.sleep(16)
box = mailpit("/api/v1/messages")
subjects = sorted(m["Subject"] for m in box["messages"])
check("one letter and one reminder", subjects,
      ["Reminder: your estimate for Tubular armchair", "Your estimate for Tubular armchair"])
time.sleep(8)
box = mailpit("/api/v1/messages")
check("exactly one reminder", len(box["messages"]), 2)

# a reminder does not follow an answer
clear_mail()
s, page, _ = short.call("POST", "/api/pieces/3/client-page", {})
token = page["clientPage"]["address"].rsplit("/", 1)[-1]
short.call("POST", f"/api/client-pages/{token}/answer", {"seatHeight": "44.5"})
wait_for_mail(1)
time.sleep(16)
box = mailpit("/api/v1/messages")
check("no reminder once an answer came", len(box["messages"]), 1)

# ------------------------------------------------------- the dossier's PDF
# On a copy whose download window the API probe has already used, the published
# limit would answer 429, so the dossier is read on the spare copy.
print()
print("== the dossier ==")
spare = Desk("http://127.0.0.1:4186")
spare.sign_in()
for _ in range(60):
    s, b, _ = spare.call("GET", "/api/pieces/6/dossier")
    if s == 200 and b["dossier"]["state"] == "signed":
        break
    time.sleep(1)
check("the seeded dossier is signed", b["dossier"]["state"], "signed")
desk = spare
s, pdf, headers = desk.call("GET", "/api/pieces/6/dossier/pdf")
check("the PDF is a PDF", pdf[:5], b"%PDF-")
check("content type", header_of(headers, "content-type"), "application/pdf")
check("the PDF has real content", len(pdf) > 4000, True)
flat = pdf.decode("latin-1")
check("no labour rate appears in the stored object", "636.90" not in flat and "72.00" not in flat, True)
s, b, _ = desk.call("GET", "/api/pieces/6/dossier")
check("signed", b["dossier"]["state"], "signed")
check("history in order", [h["what"] for h in b["dossier"]["history"]], ["asked", "rendered", "stored", "signed"])
s, b, _ = desk.call("POST", "/api/pieces/6/dossier/sign", {"typedName": "Agnese Ferrero"})
check("a signed dossier never changes", (s, msg(b)), (409, "A signed dossier never changes."))

print()
print(f"{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
