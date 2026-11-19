#!/usr/bin/env python3
"""Checks the published API behaviour against the brief. Verification only."""
import json
import sys
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://127.0.0.1:4173"
jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

passed = 0
failed = []


def call(method, path, body=None, raw=None, headers=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", ctype)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with opener.open(req, timeout=30) as r:
            text = r.read().decode("utf-8", "replace")
            return r.status, (json.loads(text) if text and "json" in r.headers.get("content-type", "") else text), dict(r.headers)
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return e.code, json.loads(text), dict(e.headers)
        except Exception:
            return e.code, text, dict(e.headers)


def check(label, got, want):
    global passed
    if got == want:
        passed += 1
        print(f"ok   {label}")
    else:
        failed.append(label)
        print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")


def msg(body):
    return body.get("error", {}).get("message") if isinstance(body, dict) else None


# ---------------------------------------------------------------- desk access
s, b, _ = call("POST", "/api/session", {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"})
check("sign in 200", s, 200)
check("sign in landing", b["session"]["landing"], "/pieces")

s, b, _ = call("POST", "/api/session", {"email": "agnese@bottega-semenza.example", "password": "wrong-password-1"})
check("sign in wrong pair 401", s, 401)
check("sign in F-09", msg(b), "That email and password do not match.")

s, b, _ = call("POST", "/api/session", {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027", "returnTo": "/pieces/1"})
check("returnTo honoured", b["session"]["landing"], "/pieces/1")
for bad in ["//evil.example", "https://evil.example", "/\\evil", "nope"]:
    s, b, _ = call("POST", "/api/session", {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027", "returnTo": bad})
    check(f"returnTo refused {bad}", b["session"]["landing"], "/pieces")

s, b, _ = call("POST", "/api/sign-up", {"name": "X", "email": "agnese@bottega-semenza.example", "password": "long-enough-1"})
check("sign-up taken 409", s, 409)
check("sign-up F-109", msg(b), "That email already has a desk.")
s, b, _ = call("POST", "/api/sign-up", {"name": "X", "email": "nope@x.example", "password": "short"})
check("sign-up short password", b["error"]["fields"]["password"], "Use at least 10 characters.")

# sign back in as Agnese
call("POST", "/api/session", {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"})

# ------------------------------------------------------------------- stamps
s, b, _ = call("POST", "/api/pieces", {"clientId": "1", "title": "Probe chair", "stampNumber": "48201769"})
check("bad stamp 422", s, 422)
check("bad stamp F-13", b["error"]["fields"]["stampNumber"], "That stamp number does not check out. Read it again from the frame.")

s, b, _ = call("POST", "/api/pieces", {"clientId": "1", "title": "Probe chair", "stampNumber": "48201768"})
check("stamp taken 409", s, 409)
check("stamp taken F-14", msg(b), "Another piece on this desk has that stamp number.")

s, b, _ = call("POST", "/api/pieces", {"clientId": "8", "title": "Probe chair"})
check("other desk clientId 404", s, 404)

s, b, _ = call("POST", "/api/pieces", {"clientId": "1", "title": "Probe chair", "widthCm": "12,50"})
check("number textbox F-112", b["error"]["fields"]["widthCm"], "That is not a number. Write it like 12.50.")

s, b, _ = call("POST", "/api/pieces", {"clientId": "1", "title": "Probe chair", "dueDate": "29-03-2027"})
check("date F-07", b["error"]["fields"]["dueDate"], "That is not a date.")

s, probe, _ = call("POST", "/api/pieces", {"clientId": "1", "title": "Probe chair", "notes": "n"})
check("piece created 201", s, 201)
PROBE = probe["piece"]["id"]
check("new piece no stamp", probe["piece"]["stampNumber"], None)

s, b, _ = call("POST", "/api/pieces", {"duplicateOf": PROBE})
check("duplicate 201", s, 201)
check("duplicate title", b["piece"]["title"], "Probe chair (copy)")
check("duplicate no stamp", b["piece"]["stampNumber"], None)
check("duplicate state", b["piece"]["state"], "received")
DUP = b["piece"]["id"]

# --------------------------------------------------------------------- pins
s, b, _ = call("POST", f"/api/pieces/{PROBE}/pins", {"x": 12.5, "y": 80, "kind": "looseJoint", "note": "**Loose** at the back rail", "signed": True})
check("pin 201", s, 201)
check("pin number 1", b["pin"]["number"], 1)
check("pin x", b["pin"]["x"], "12.5")
check("pin y", b["pin"]["y"], "80.0")
PIN1 = b["pin"]["id"]

for bad, want in [(-1, "That number is out of range."), (100.5, "That number is out of range."), (12.55, "That number is out of range.")]:
    s, b, _ = call("POST", f"/api/pieces/{PROBE}/pins", {"x": bad, "y": 10, "kind": "tear"})
    check(f"pin x={bad} F-08", b["error"]["fields"]["x"], want)
s, b, _ = call("POST", f"/api/pieces/{PROBE}/pins", {"x": "abc", "y": 10, "kind": "tear"})
check("pin x non-numeric F-112", b["error"]["fields"]["x"], "That is not a number. Write it like 12.50.")

s, _, _ = call("DELETE", f"/api/pieces/{PROBE}/pins/{PIN1}")
check("pin removed 204", s, 204)
s, b, _ = call("POST", f"/api/pieces/{PROBE}/pins", {"x": 1, "y": 1, "kind": "tear"})
check("pin number never reused", b["pin"]["number"], 2)

# ------------------------------------------------------------------- layout
s, lay, _ = call("GET", f"/api/pieces/{PROBE}/layout")
check("new piece: all five in tray", [p["state"] for p in lay["layout"]["pieces"]], ["tray"] * 5)
check("hide area", lay["layout"]["hide"]["areaSqFt"], "51.67")
check("figure empty", lay["layout"]["usedSqFt"], "0.00")
V = lay["layout"]["version"]

s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Seat", {"x": 0, "y": 0, "rotation": 0, "version": V})
check("place Seat 200", s, 200)
check("figure Seat", (b["layout"]["usedSqFt"], b["layout"]["usedPercent"]), ("3.87", "7.5"))
V = b["layout"]["version"]

s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Seat", {"x": 0, "y": 0, "rotation": 90, "version": V})
check("grain F-50", msg(b), "Seat runs with the grain and turns only 0 or 180.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Seat", {"x": 0, "y": 0, "rotation": 45, "version": V})
check("rotation 45 F-08", b["error"]["fields"]["rotation"], "That number is out of range.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Headrest", {"x": 0, "y": 0, "rotation": -90, "version": V})
check("headrest -90 F-08", b["error"]["fields"]["rotation"], "That number is out of range.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Back", {"x": 180, "y": 0, "rotation": 0, "version": V})
check("off hide F-47", msg(b), "Back cannot go there. It runs off the hide.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Back", {"x": -1, "y": 0, "rotation": 0, "version": V})
check("negative x F-47", msg(b), "Back cannot go there. It runs off the hide.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Back", {"x": 1.5, "y": 0, "rotation": 0, "version": V})
check("fractional x F-08", b["error"]["fields"]["x"], "That number is out of range.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Back", {"x": 110, "y": 70, "rotation": 0, "version": V})
check("flaw F-48", msg(b), "Back cannot go there. It crosses the flaw at 120, 80 cm.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Back", {"x": 0, "y": 0, "rotation": 0, "version": V})
check("overlap F-49", msg(b), "Back cannot go there. It overlaps Seat.")
s, b, _ = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Back", {"x": 0, "y": 58, "rotation": 0, "version": V})
check("touching edges allowed", s, 200)
V2 = b["layout"]["version"]
s, b, h = call("PUT", f"/api/pieces/{PROBE}/layout/placements/Left%20side", {"x": 70, "y": 0, "rotation": 0, "version": V})
check("stale 412", s, 412)
check("stale F-51", msg(b).startswith("This layout was changed at "), True)
check("stale F-51 tail", msg(b).endswith(" Turin time in another window. Your piece is still lifted."), True)

# all five placed -> 14.54 / 28.1
call("POST", f"/api/pieces/{PROBE}/layout", {"version": V2, "placements": [
    {"name": "Seat", "x": 0, "y": 0, "rotation": 0},
    {"name": "Back", "x": 0, "y": 58, "rotation": 0},
    {"name": "Left side", "x": 62, "y": 0, "rotation": 0},
    {"name": "Right side", "x": 92, "y": 0, "rotation": 0},
    {"name": "Headrest", "x": 0, "y": 132, "rotation": 0}]})
s, b, _ = call("GET", f"/api/pieces/{PROBE}/layout")
check("all five figure", (b["layout"]["usedSqFt"], b["layout"]["usedPercent"]), ("14.54", "28.1"))

# ------------------------------------------------------------------ holds
s, b, _ = call("POST", f"/api/pieces/{PROBE}/holds", {"code": "VM-2041", "lot": "L-2041-A", "quantity": 2})
check("hold 201", s, 201)
check("hold label", b["hold"]["label"].startswith("Held until "), True)
s, b2, _ = call("POST", f"/api/pieces/{PROBE}/holds", {"code": "VM-2041", "lot": "L-2041-A", "quantity": 2})
check("hold repeat 200", s, 200)
check("hold repeat same", b2["hold"]["id"], b["hold"]["id"])
s, b, _ = call("POST", f"/api/pieces/{PROBE}/holds", {"code": "VM-2041", "lot": "L-2041-A", "quantity": 1})
check("same lot other quantity F-41", msg(b), "This lot is already held for this piece for 2 hides.")
s, b, _ = call("POST", f"/api/pieces/{PROBE}/holds", {"code": "VM-2041", "lot": "L-2041-B", "quantity": 1})
check("second lot F-40", msg(b), "This piece is held on lot L-2041-A. All its hides come from one dye lot.")
s, b, _ = call("POST", f"/api/pieces/{DUP}/holds", {"code": "VM-2041", "lot": "L-2041-A", "quantity": 3})
check("no lot holds 3 F-37", msg(b), "No single dye lot holds 3 hides of Tabacco. The largest holds 2.")
s, b, _ = call("POST", f"/api/pieces/{DUP}/holds", {"code": "VM-2041", "lot": "L-2041-B", "quantity": 2})
check("chosen lot too small F-39", msg(b), "Lot L-2041-B holds 1 hide.")
s, b, _ = call("POST", f"/api/pieces/{DUP}/holds", {"code": "VM-3051", "lot": "L-3000-A", "quantity": "50.00"})
check("fabric F-38", msg(b), "No single dye lot holds 50.00 m of Loden. The largest holds 40.00 m.")
s, b, _ = call("POST", f"/api/pieces/2/holds", {"code": "VM-2044", "lot": "L-2044-A", "quantity": 1})
check("ended hold F-34", msg(b).startswith("Hold ended on "), True)

# --------------------------------------------------------------- estimates
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates/preview", {"materialCode": "VM-2041", "lot": "L-2041-A", "patternAreaSqFt": "62.50", "labourHours": "12.50"})
check("preview hides 2", b["estimate"]["hides"], 2)
check("preview no id", "id" in b["estimate"], False)
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates", {"materialCode": "VM-2041", "lot": "L-2041-A", "patternAreaSqFt": "125.00", "labourHours": "1.00"})
check("estimate lot too small F-37", msg(b), "No single dye lot holds 3 hides of Tabacco. The largest holds 2.")
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates", {"materialCode": "VM-2041", "lot": "L-2041-A", "patternAreaSqFt": "14.54", "labourHours": "12.30"})
check("labour quarter F-56", b["error"]["fields"]["labourHours"], "Labour goes in quarter hours.")
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates", {"materialCode": None, "lot": None, "labourHours": "2.75"})
check("frame-only 201", s, 201)
check("frame-only labour", b["estimate"]["display"]["labour"], "\u20ac233.75")
check("frame-only tax", b["estimate"]["display"]["tax"], "\u20ac51.43")
check("frame-only version", b["estimate"]["version"], 1)
E1 = b["estimate"]["version"]
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates", {"materialCode": None, "lot": None, "labourHours": "3.00", "openVersion": E1})
check("replace open 201", s, 201)
check("next version", b["estimate"]["version"], 2)
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates", {"materialCode": None, "lot": None, "labourHours": "4.00", "openVersion": E1})
check("stale estimate 412", s, 412)
check("stale F-55", msg(b).endswith(" Turin time in another window. Your figures are still here."), True)
s, b, _ = call("GET", f"/api/pieces/{PROBE}/estimates")
check("earlier estimate replaced", b["estimates"][1]["state"], "replaced")
# unpublished keys ignored
s, b, _ = call("POST", f"/api/pieces/{PROBE}/estimates", {"materialCode": None, "lot": None, "labourHours": "2.00",
                                                          "deskId": "2", "pieceId": "8", "totalMinor": 1, "state": "signedOff", "labourRateMinor": 1})
check("unpublished keys ignored: state", b["estimate"]["state"], "open")
check("unpublished keys ignored: total", b["estimate"]["display"]["total"], "\u20ac207.40")
check("unpublished keys ignored: rate", b["estimate"]["labourRateMinor"], 8500)

# ------------------------------------------------------------------- rates
s, b, _ = call("POST", "/api/rates", {"takesEffectOn": "2019-01-01", "EUR": "90.00", "GBP": "76.00", "USD": "97.00", "JPY": "14600", "AED": "360.00"})
check("rate too early F-59", msg(b), "Rates take effect today or later.")
s, b, _ = call("POST", "/api/rates", {"takesEffectOn": "2020-01-01", "EUR": "90.00", "GBP": "76.00", "USD": "97.00", "JPY": "14600", "AED": "360.00"})
check("rate past day F-59", msg(b), "Rates take effect today or later.")

# ------------------------------------------------------------- client page
s, b, _ = call("POST", f"/api/pieces/{PROBE}/client-page", {})
check("client page no due date F-62", msg(b), "Give this piece a due date first.")
call("PATCH", f"/api/pieces/{PROBE}", {"dueDate": "2027-12-24"})
s, cp, _ = call("POST", f"/api/pieces/{PROBE}/client-page", {})
check("client page 201", s, 201)
TOKEN = cp["clientPage"]["address"].rsplit("/", 1)[-1]
check("token length >= 22", len(TOKEN) >= 22, True)
s, b, _ = call("GET", f"/api/client-pages/{TOKEN}")
check("page language it", b["page"]["language"], "it")
check("page dir ltr", b["page"]["dir"], "ltr")
check("page has no rate", "labourRate" in json.dumps(b["page"]), False)
check("page has no hours", "labourHours" in json.dumps(b["page"]), False)
s, b, _ = call("POST", f"/api/client-pages/{TOKEN}/answer", {"seatHeight": "44.5"})
check("it page refuses 44.5", b["error"]["fields"]["seatHeight"], "Scrivi l'altezza cos\u00ec: 44,5.")
s, b, _ = call("POST", f"/api/client-pages/{TOKEN}/answer", {"seatHeight": "   "})
check("blank height C23", b["error"]["fields"]["seatHeight"], "Questo campo \u00e8 obbligatorio.")
s, b, _ = call("POST", f"/api/client-pages/{TOKEN}/answer", {"seatHeight": "44,5"})
check("it page accepts 44,5", s, 200)
check("answer decimal string", b["answer"]["seatHeightCm"], "44.5")
check("answer typed kept", b["answer"]["typed"], "44,5")

s, b, _ = call("GET", "/api/client-pages/not-a-real-token")
check("unknown token 404", s, 404)

# sign-off
s, page, _ = call("GET", f"/api/client-pages/{TOKEN}")
EID = page["page"]["estimateId"]
s, b, _ = call("POST", f"/api/client-pages/{TOKEN}/sign-off", {"estimateId": EID, "typedName": "wrong name"})
check("sign-off wrong name C14", b["error"]["fields"]["typedName"], "Non \u00e8 il nome che abbiamo. Scrivi il tuo nome completo.")
s, b, _ = call("POST", f"/api/client-pages/{TOKEN}/sign-off", {"estimateId": EID, "typedName": "  giulia ricci  "})
check("sign-off folded name 200", s, 200)
s, b, _ = call("POST", f"/api/client-pages/{TOKEN}/sign-off", {"estimateId": EID, "typedName": "Giulia Ricci"})
check("second sign-off 409", s, 409)
check("second sign-off code", b["error"]["code"], "alreadySignedOff")
check("second sign-off C17", msg(b).startswith("Gi\u00e0 approvato alle "), True)

# a new address ends the old one
s, cp2, _ = call("POST", f"/api/pieces/{PROBE}/client-page", {})
TOKEN2 = cp2["clientPage"]["address"].rsplit("/", 1)[-1]
s, b, _ = call("GET", f"/api/client-pages/{TOKEN}")
check("old address ended 410", s, 410)
check("ended C20 in it", msg(b), "Questa pagina \u00e8 scaduta.")
s, b, _ = call("GET", f"/api/client-pages/{TOKEN2}")
check("new address live", s, 200)

# a replaced estimate, on a piece whose estimate is still open
call("PATCH", f"/api/pieces/{DUP}", {"dueDate": "2027-12-24"})
call("POST", f"/api/pieces/{DUP}/estimates", {"materialCode": None, "lot": None, "labourHours": "1.00"})
s, cp3, _ = call("POST", f"/api/pieces/{DUP}/client-page", {})
TOKEN3 = cp3["clientPage"]["address"].rsplit("/", 1)[-1]
s, b, _ = call("GET", f"/api/client-pages/{TOKEN3}")
OPEN_E = b["page"]["estimateId"]
call("POST", f"/api/pieces/{DUP}/estimates", {"materialCode": None, "lot": None, "labourHours": "5.00"})
s, b, _ = call("POST", f"/api/client-pages/{TOKEN3}/sign-off", {"estimateId": OPEN_E, "typedName": "Giulia Ricci"})
check("replaced estimate 409", s, 409)
check("replaced code", b["error"]["code"], "estimateReplaced")
check("replaced C18", msg(b).startswith("\u00c8 stato fatto un preventivo pi\u00f9 recente alle "), True)

# ------------------------------------------------------------------- bench
s, b, _ = call("GET", "/api/bench-jobs")
check("bench week jobs", len(b["jobs"]), 2)
WEEK = b["week"]
s, b, _ = call("POST", "/api/bench-jobs", {"pieceId": PROBE, "bench": "frame", "day": WEEK})
check("bench taken F-66", msg(b).startswith("That bench is taken on "), True)
import datetime
mon = datetime.date.fromisoformat(WEEK)
sat = (mon + datetime.timedelta(days=5)).isoformat()
s, b, _ = call("POST", "/api/bench-jobs", {"pieceId": PROBE, "bench": "frame", "day": sat})
check("weekend F-70", msg(b), "The bench works Monday to Friday.")
tue = (mon + datetime.timedelta(days=1)).isoformat()
s, job, _ = call("POST", "/api/bench-jobs", {"pieceId": PROBE, "bench": "frame", "day": tue})
check("bench job 201", s, 201)
JOB = job["job"]["id"]
check("bench job message", job["message"], f"Probe chair added to Frame bench on {job['job']['dayLabel']}.")
s, b, _ = call("POST", f"/api/bench-jobs/{JOB}/glue", {"date": tue, "time": "25:00"})
check("bad time F-111", b["error"]["fields"]["time"], "That is not a time. Write it like 09:00.")
s, b, _ = call("POST", f"/api/bench-jobs/{JOB}/glue", {"date": "2027-03-28", "time": "02:30"})
check("non-existent time F-68", msg(b), "02:30 does not exist in Turin on Sun 28 Mar 2027.")
s, b, _ = call("POST", f"/api/bench-jobs/{JOB}/glue", {"date": tue, "time": "10:00"})
check("glue laid 200", s, 200)
check("glue message", b["message"].startswith("Glue laid on Probe chair. It cures at "), True)
check("glue state curing", b["job"]["glue"]["state"], "curing")
thu = (mon + datetime.timedelta(days=3)).isoformat()
fri = (mon + datetime.timedelta(days=4)).isoformat()
s, b, _ = call("POST", "/api/bench-jobs", {"pieceId": PROBE, "bench": "cover", "day": thu})
check("cover too early F-67", msg(b).startswith("The glue on Probe chair cures until "), True)
s, b, _ = call("POST", "/api/bench-jobs", {"pieceId": PROBE, "bench": "cover", "day": fri})
check("cover after cure 201", s, 201)

# ------------------------------------------------------------- collections
s, b, _ = call("POST", f"/api/pieces/{PROBE}/collections/quote", {})
check("quote needs measurements F-78", msg(b), "This piece needs its width, depth, height and weight first.")
s, b, _ = call("POST", "/api/pieces/5/collections/quote", {})
check("quote 200", s, 200)
check("quote display", b["quote"]["display"], "\u20ac412.50")
QID = b["quote"]["quoteId"]
s, b, _ = call("POST", "/api/pieces/5/collections", {"quoteId": QID, "localDate": "2027-03-29", "localTime": "09:00"})
check("booking 201", s, 201)
check("booking state", b["collection"]["state"], "booked")
check("booking collectAt", b["collection"]["collectAt"], "2027-03-29T05:00:00Z")
check("booking display", b["collection"]["display"], "Mon 29 Mar 2027, 09:00 Dubai time \u00b7 07:00 Turin time")
check("booking label stored", b["collection"]["labelSha256"], "10b41b820211bdb162a7ee68a13fc3425999ee467b8e38b9059514da8a66a956")
CID = b["collection"]["id"]
s, b, _ = call("POST", "/api/pieces/5/collections", {"quoteId": QID, "localDate": "2027-03-29", "localTime": "09:00"})
check("booking repeat 200", s, 200)
check("booking repeat same", b["collection"]["id"], CID)
s, b, _ = call("POST", "/api/pieces/5/collections", {"quoteId": QID, "localDate": "2027-03-30", "localTime": "09:00"})
check("other time same quote F-79", msg(b), "This piece is already booked for Mon 29 Mar 2027, 09:00 Dubai time.")
s, b, h = call("GET", f"/api/pieces/5/collections/{CID}/label")
check("label bytes", len(b) if isinstance(b, str) else 0, 23)

# ---------------------------------------------------------------- enquiries
for i in range(3):
    s, b, _ = call("POST", "/api/enquiries", {"name": "Tomas\n\nWeil", "email": "tomas@example.org", "message": "A bentwood armchair with a split seat."})
    check(f"enquiry {i+1} 202", (s, b), (202, {"received": True}))
s, b, h = call("POST", "/api/enquiries", {"name": "Tomas Weil", "email": "TOMAS@example.org", "message": "again"})
check("4th enquiry 429", s, 429)
check("4th enquiry F-12", msg(b).startswith("Too many enquiries. You can try again at "), True)
check("Retry-After present", "Retry-After" in h or "retry-after" in {k.lower(): v for k, v in h.items()}, True)

# --------------------------------------------------------------- workbook
hdr = "client,piece,maker,year,stamp,material,notes\r\n"
good = hdr + '"Ricci, G.","Chair ""A""",M,1957,10000009,VM-2041,"line\nbreak"\r\n'
s, b, _ = call("POST", "/api/workbook/preview", None, raw=('--B\r\nContent-Disposition: form-data; name="file"; filename="w.csv"\r\nContent-Type: text/csv\r\n\r\n' + good + '\r\n--B--\r\n').encode(), ctype="multipart/form-data; boundary=B")
check("workbook preview 200", s, 200)
check("workbook row number by record", b["rows"][0]["row"], 2)
check("workbook quoted newline kept", b["rows"][0]["piece"], 'Chair "A"')
extra = "client,piece,maker,year,stamp,material,notes,extra\r\n"
s, b, _ = call("POST", "/api/workbook/preview", None, raw=('--B\r\nContent-Disposition: form-data; name="file"; filename="w.csv"\r\n\r\n' + extra + '\r\n--B--\r\n').encode(), ctype="multipart/form-data; boundary=B")
check("workbook extra column F-80", msg(b), "This file has a column the desk does not know: extra.")
missing = "client,piece,maker,year,stamp,material\r\n"
s, b, _ = call("POST", "/api/workbook/preview", None, raw=('--B\r\nContent-Disposition: form-data; name="file"; filename="w.csv"\r\n\r\n' + missing + '\r\n--B--\r\n').encode(), ctype="multipart/form-data; boundary=B")
check("workbook missing column F-81", msg(b), "This file is missing a column: notes.")

s, b, _ = call("GET", "/api/materials-list.csv")
check("materials list CRLF", b.endswith("\r\n"), True)
check("materials list header quoted", b.split("\r\n")[0], '"piece","client","material","code","lot","hides","notes"')

# ----------------------------------------------------------------- dossier
import time
for _ in range(60):
    s, b, _ = call("GET", "/api/pieces/6/dossier")
    if s == 200 and b["dossier"]["state"] == "signed":
        break
    time.sleep(1)
check("seeded dossier signed", b["dossier"]["state"], "signed")
s, bare, _ = call("POST", "/api/pieces", {"clientId": "1", "title": "Bare chair"})
s, b, _ = call("POST", f"/api/pieces/{bare['piece']['id']}/dossier", {})
check("dossier no signed estimate F-92", msg(b), "This piece has no signed-off estimate yet.")
s, b, _ = call("POST", "/api/pieces/6/dossier", {})
check("dossier signed F-96", msg(b), "A signed dossier never changes.")
for i in range(5):
    s, _, _ = call("GET", "/api/pieces/6/dossier/pdf")
    check(f"dossier download {i+1}", s, 200)
s, b, h = call("GET", "/api/pieces/6/dossier/pdf")
check("6th download 429", s, 429)
check("6th download F-91", msg(b).startswith("Too many downloads. You can try again at "), True)

# ----------------------------------------------------------- erased client
s, b, _ = call("DELETE", f"/api/clients/1")
check("delete with pieces F-98", msg(b), "Close this client instead.")

print()
print(f"{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
