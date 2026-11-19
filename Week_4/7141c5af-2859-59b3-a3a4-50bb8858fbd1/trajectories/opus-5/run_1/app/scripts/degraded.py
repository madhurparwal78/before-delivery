#!/usr/bin/env python3
"""Checks each copy's published behaviour with its provider down, and the
short-timer and short-session copies. Verification only."""
import json
import sys
import time
import urllib.error
import urllib.request
import http.cookiejar

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
    def __init__(self, port):
        self.base = f"http://127.0.0.1:{port}"
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method, path, body=None, raw=None, ctype="application/json"):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if data is not None:
            req.add_header("Content-Type", ctype)
        try:
            with self.opener.open(req, timeout=60) as r:
                text = r.read()
                ct = r.headers.get("content-type", "")
                return r.status, (json.loads(text) if text and "json" in ct else text), dict(r.headers)
        except urllib.error.HTTPError as e:
            text = e.read()
            try:
                return e.code, json.loads(text), dict(e.headers)
            except Exception:
                return e.code, text, dict(e.headers)

    def sign_in(self, email="agnese@bottega-semenza.example", password="tacks-and-hide-2027"):
        return self.call("POST", "/api/session", {"email": email, "password": password})


def msg(body):
    return body.get("error", {}).get("message") if isinstance(body, dict) else None


def png_part(name="p.png"):
    # A one-pixel PNG made the same way the app makes its own.
    import zlib
    import struct

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0)
    idat = zlib.compress(b"\x00\x80", 9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    boundary = "B"
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
        "Content-Type: image/png\r\n\r\n".encode()
        + png
        + f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"side\"\r\n\r\nbefore\r\n--{boundary}--\r\n".encode()
    )
    return body, f"multipart/form-data; boundary={boundary}"


# ------------------------------------------------------- the file store down
print("== MinIO down ==")
storage = Desk(4181)
check("health answers whatever is down", storage.call("GET", "/api/health")[1], {"status": "ok"})
storage.sign_in()
s, b, _ = storage.call("GET", "/api/pieces")
check("lists still work", s, 200)
s, b, _ = storage.call("GET", "/api/pieces/1/photographs")
check("seeded rows read Waiting", {row["state"] for row in b["photographs"]}, {"waiting"})
raw, ctype = png_part()
s, b, _ = storage.call("POST", "/api/pieces/1/photographs", raw=raw, ctype=ctype)
check("upload answers 503", s, 503)
check("upload reads F-27", msg(b), "The file store is unavailable right now. Nothing was saved.")
s, b, _ = storage.call("GET", "/api/pieces/3/collections")
waiting = [row for row in b["collections"] if row["state"] == "waiting"]
check("seeded collection waits", len(waiting), 2)
check("its label is not stored", waiting[0]["labelSha256"], None)
s, b, _ = storage.call("GET", f"/api/pieces/3/collections/{waiting[0]['id']}/label")
check("its label address answers 503 F-27", (s, msg(b)), (503, "The file store is unavailable right now. Nothing was saved."))
s, b, _ = storage.call("GET", "/api/pieces/6/dossier")
check("the seeded dossier does not say stored", b["dossier"]["state"] in ("waiting", "failed"), True)
if b["dossier"]["state"] == "failed":
    check("its message is F-27", b["dossier"]["message"], "The file store is unavailable right now. Nothing was saved.")
s, b, _ = storage.call("POST", "/api/pieces/5/collections/quote", {})
check("a quote still answers", s, 200)
s, b, _ = storage.call(
    "POST", "/api/pieces/5/collections", {"quoteId": b["quote"]["quoteId"], "localDate": "2027-03-29", "localTime": "09:00"}
)
check("booking refuses before any courier call", (s, msg(b)), (503, "The courier could not confirm. Nothing was booked."))

# --------------------------------------------------------- Gotenberg down
print()
print("== Gotenberg down ==")
render = Desk(4182)
render.sign_in()
s, b, _ = render.call("GET", "/api/pieces/6/dossier")
check("the seeded dossier failed", b["dossier"]["state"], "failed")
check("its message is F-90", b["dossier"]["message"], "The PDF service is unavailable right now. Nothing was saved.")
s, b, _ = render.call("GET", "/api/pieces/6/dossier/pdf")
check("no PDF to download", (s, msg(b)), (409, "The dossier is not stored yet."))
s, b, _ = render.call("POST", "/api/pieces/6/dossier/sign", {"typedName": "Agnese Ferrero"})
check("cannot sign what is not stored", (s, msg(b)), (409, "The dossier is not stored yet."))
s, b, _ = render.call("GET", "/api/pieces/1/photographs")
check("files still store with only the renderer down", {row["state"] for row in b["photographs"]}, {"stored"})

# ------------------------------------------------------------ search down
print()
print("== search down ==")
search = Desk(4183)
search.sign_in()
s, b, _ = search.call("GET", "/api/pieces")
check("lists keep working from Postgres", (s, len(b["pieces"])), (200, 7))
s, b, h = search.call("GET", "/api/search?q=tabaco")
check("search answers 503", s, 503)
check("search reads F-17", msg(b), "Search is unavailable right now. The full list is still here.")
s, b, _ = search.call("POST", "/api/materials/refresh", {})
check("refresh refuses", s, 503)
check("refresh reads F-30", msg(b), "Search could not take the new entries. Your library has not changed.")
s, b, _ = search.call("GET", "/api/materials")
check("the library has not changed", len(b["materials"]), 12)

# the closing journey, with a five-second wait on this copy
s, client, _ = search.call("POST", "/api/clients", {"name": "Closing Probe", "town": "Turin"})
cid = client["client"]["id"]
s, b, _ = search.call("POST", f"/api/clients/{cid}/close", {})
check("closed", b["client"]["state"], "closing")
s, b, _ = search.call("POST", f"/api/clients/{cid}/bring-back", {})
check("brought back within the wait", b["client"]["state"], "active")
search.call("POST", f"/api/clients/{cid}/close", {})
time.sleep(9)
s, b, _ = search.call("GET", "/api/clients")
row = next((c for c in b["clients"] if c["id"] == cid), None)
check("stays erasing while search is down", row, None)
s, b, _ = search.call("POST", f"/api/clients/{cid}/bring-back", {})
check("bring-back after the wait answers 404 from erasing on", s, 404)

# ----------------------------------------------------------- short timers
print()
print("== short timers ==")
short = Desk(4184)
short.sign_in()
s, page, _ = short.call("POST", "/api/pieces/1/client-page", {})
token = page["clientPage"]["address"].rsplit("/", 1)[-1]
s, b, _ = short.call("GET", f"/api/client-pages/{token}")
check("page live", s, 200)
print("   waiting out CLIENT_PAGE_SECONDS=20")
time.sleep(22)
s, b, _ = short.call("GET", f"/api/client-pages/{token}")
check("page ends at its instant", s, 410)
check("ended copy in the client's language", msg(b), "Questa pagina \u00e8 scaduta.")

# the dossier download limit, 5 per FILE_RATE_WINDOW_SECONDS=30
for i in range(5):
    s, _, _ = short.call("GET", "/api/pieces/6/dossier/pdf")
    check(f"download {i+1}", s, 200)
s, b, h = short.call("GET", "/api/pieces/6/dossier/pdf")
check("6th download 429", s, 429)
retry = h.get("Retry-After") or h.get("retry-after")
check("Retry-After in whole seconds", retry is not None and retry.isdigit(), True)

# the closing journey end to end, with CLOSURE_WAIT_SECONDS=20
s, client, _ = short.call("POST", "/api/clients", {"name": "Erase Probe", "town": "Turin"})
cid = client["client"]["id"]
short.call("POST", f"/api/clients/{cid}/close", {})
print("   waiting out CLOSURE_WAIT_SECONDS=20")
time.sleep(26)
s, b, _ = short.call("GET", "/api/clients")
row = next((c for c in b["clients"] if c["id"] == cid), None)
check("erased row reads Erased client", row, {"id": cid, "name": "Erased client", "state": "erased"})
s, b, _ = short.call("GET", f"/api/clients/{cid}")
check("its address answers 404", s, 404)

# The stock cache: within STOCK_CACHE_SECONDS the same code is not read again,
# which the server's own record of when it last read it proves.
import subprocess

def fetched_at(code):
    out = subprocess.run(
        ["node", "-e", """
          const pg = require('pg');
          (async () => {
            const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL + '?options=-c%20search_path%3Dcopy_short' });
            const r = await pool.query('SELECT fetched_at FROM stock_reads WHERE code = $1', [process.argv[1]]);
            console.log(r.rows[0] ? r.rows[0].fetched_at.toISOString() : 'none');
            await pool.end();
          })();
        """, code],
        capture_output=True, text=True, cwd=".")
    return out.stdout.strip()

short.call("GET", "/api/materials/VM-2046/lots")
first = fetched_at("VM-2046")
short.call("GET", "/api/materials/VM-2047/lots")
short.call("GET", "/api/materials/VM-2046/lots")
check("the same code is not read again inside the window", fetched_at("VM-2046"), first)
print("   waiting out STOCK_CACHE_SECONDS=10")
time.sleep(12)
short.call("GET", "/api/materials/VM-2046/lots")
check("it is read again once the window has passed", fetched_at("VM-2046") != first, True)

# ---------------------------------------------------------- short session
print()
print("== short session ==")
session = Desk(4185)
session.sign_in()
s, b, _ = session.call("GET", "/api/session")
check("session live", s, 200)
print("   waiting out SESSION_SECONDS=20")
time.sleep(22)
s, b, _ = session.call("GET", "/api/session")
check("the session ended", s, 401)
check("code sessionEnded", b["error"]["code"], "sessionEnded")
check("message F-03", msg(b), "Your session ended. Sign in again to keep going \u2014 what you typed is still here.")

# -------------------------------------------------------- a rate from today
print()
print("== a rate taking effect today ==")
spare = Desk(4186)
spare.sign_in()
today = spare.call("GET", "/api/session")[1]["session"]["today"]
s, before, _ = spare.call("POST", "/api/pieces/1/estimates", {"materialCode": None, "lot": None, "labourHours": "1.00"})
check("the earlier estimate uses the starting rate", before["estimate"]["labourRateMinor"], 8500)
s, b, _ = spare.call(
    "POST", "/api/rates",
    {"takesEffectOn": today, "EUR": "90.00", "GBP": "76.00", "USD": "97.00", "JPY": "14600", "AED": "360.00"},
)
check("rate from today 201", s, 201)
check("rate message", b["message"].startswith("Rate saved. It applies to new estimates from "), True)
s, after, _ = spare.call(
    "POST", "/api/pieces/1/estimates",
    {"materialCode": None, "lot": None, "labourHours": "1.00", "openVersion": before["estimate"]["version"]},
)
check("a new estimate takes the new rate", after["estimate"]["labourRateMinor"], 9000)
s, b, _ = spare.call("GET", "/api/pieces/1/estimates")
kept = next(e for e in b["estimates"] if e["version"] == before["estimate"]["version"])
check("the earlier estimate keeps its own rate", kept["labourRateMinor"], 8500)
s, b, _ = spare.call(
    "POST", "/api/rates",
    {"takesEffectOn": today, "EUR": "91.00", "GBP": "76.00", "USD": "97.00", "JPY": "14600", "AED": "360.00"},
)
check("a second rate on that day 409", (s, msg(b)), (409, "A rate already takes effect on that day."))

print()
print(f"{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
