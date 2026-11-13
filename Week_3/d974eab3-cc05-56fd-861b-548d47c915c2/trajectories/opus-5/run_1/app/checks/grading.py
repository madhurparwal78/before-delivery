#!/usr/bin/env python3
"""Developer check of the grading route's shape rules and the product sheet.

Not shipped.
"""
import copy
import json
import os
import subprocess
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4173"
KEY = os.environ["GRADING_KEY"]

PRODUCT = {
    "name": "Vireo Pace",
    "format": "Drink stick, 6 g of powder",
    "serving": "One stick in 150 ml of water",
    "packs": [{"sticks": 14, "price_yen": 1980}, {"sticks": 30, "price_yen": 3960}],
    "ingredients": [
        {"name": "Red beet root powder", "mg": 3000},
        {"name": "Dextrin", "mg": 2400},
    ],
    "how_to_use": ["Tear open one stick."],
    "storage": "Keep sealed sticks away from direct sunlight, heat and damp.",
    "cautions": ["Red beet can turn urine pink or red."],
    "stores": [{"name": "Alder Quay Online Store", "url": "https://store.alderquay.example/vireo-pace"}],
}

INTERVIEWS = [
    {
        "slug": "mina-okabe",
        "name": "Mina Okabe",
        "role": "Sports physiologist",
        "category": "expert",
        "lede": "Hard days only count if easy days follow them.",
        "hue": 150,
        "answers": [{"question": "Why?", "answer": "Because recovery is the work."}],
    }
]

IDS = [
    "on-work",
    "on-sports",
    "on-hobby",
    "on-housework",
    "off-break",
    "off-holiday",
    "off-relax",
    "off-rest",
]
SCENARIOS = [
    {
        "id": scenario_id,
        "mode": "on" if scenario_id.startswith("on-") else "off",
        "name": scenario_id,
        "title": "A moment",
        "time": "09:30",
        "copy": "Copy.",
        "moment": "Moment.",
    }
    for scenario_id in IDS
]

passed = 0
failed = 0


def check(label, want, got):
    global passed, failed
    if want == got:
        passed += 1
        print(f"ok   {label}")
    else:
        failed += 1
        print(f"FAIL {label}\n       want: {want!r}\n       got:  {got!r}")


def request(method, path, body=None, key=KEY, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if key is not None:
        req.add_header("X-Grading-Key", key)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def put(body):
    return request("PUT", "/api/grading/content", body)


def good():
    return {
        "product": copy.deepcopy(PRODUCT),
        "interviews": copy.deepcopy(INTERVIEWS),
        "scenarios": copy.deepcopy(SCENARIOS),
    }


INVALID = '{"error":"invalid","message":"The content does not match the published shape."}'

# A valid body is accepted and raises the edition.
before = json.loads(request("GET", "/api/content", key=None)[1])["edition"]
status, body = put(good())
check("valid put status", 200, status)
check("edition rises", before + 1, json.loads(body)["edition"])

cases = []


def case(label, mutate):
    body = good()
    mutate(body)
    cases.append((label, body))


case("missing product", lambda b: b.pop("product"))
case("extra top field", lambda b: b.update(extra=1))
case("extra product field", lambda b: b["product"].update(colour="red"))
case("missing product field", lambda b: b["product"].pop("storage"))
case("empty text", lambda b: b["product"].update(name=""))
case("text too long", lambda b: b["product"].update(name="x" * 1201))
case("zero packs", lambda b: b["product"].update(packs=[]))
case("four packs", lambda b: b["product"].update(packs=[{"sticks": 1, "price_yen": 1}] * 4))
case("sticks zero", lambda b: b["product"]["packs"][0].update(sticks=0))
case("sticks 101", lambda b: b["product"]["packs"][0].update(sticks=101))
case("price 100001", lambda b: b["product"]["packs"][0].update(price_yen=100001))
case("price not whole", lambda b: b["product"]["packs"][0].update(price_yen=19.5))
case("eleven ingredients", lambda b: b["product"].update(ingredients=[{"name": "a", "mg": 1}] * 11))
case("mg 10001", lambda b: b["product"]["ingredients"][0].update(mg=10001))
case("seven steps", lambda b: b["product"].update(how_to_use=["a"] * 7))
case("no steps", lambda b: b["product"].update(how_to_use=[]))
case("seven cautions", lambda b: b["product"].update(cautions=["a"] * 7))
case("five stores", lambda b: b["product"].update(stores=[{"name": "a", "url": "https://a.example"}] * 5))
case("http store", lambda b: b["product"]["stores"][0].update(url="http://a.example"))
case("no interviews", lambda b: b.update(interviews=[]))
case("thirteen interviews", lambda b: b.update(interviews=[dict(INTERVIEWS[0], slug=f"a{n}") for n in range(13)]))
case("duplicate slugs", lambda b: b.update(interviews=[dict(INTERVIEWS[0]), dict(INTERVIEWS[0])]))
case("slug starts with digit", lambda b: b["interviews"][0].update(slug="1abc"))
case("slug too short", lambda b: b["interviews"][0].update(slug="a"))
case("slug too long", lambda b: b["interviews"][0].update(slug="a" * 41))
case("slug uppercase", lambda b: b["interviews"][0].update(slug="Mina"))
case("bad category", lambda b: b["interviews"][0].update(category="pro"))
case("hue 360", lambda b: b["interviews"][0].update(hue=360))
case("hue negative", lambda b: b["interviews"][0].update(hue=-1))
case("no answers", lambda b: b["interviews"][0].update(answers=[]))
case("seven answers", lambda b: b["interviews"][0].update(answers=[{"question": "q", "answer": "a"}] * 7))
case("seven scenarios", lambda b: b.update(scenarios=b["scenarios"][:7]))
case("wrong scenario id", lambda b: b["scenarios"][0].update(id="on-nap"))
case("mode mismatch", lambda b: b["scenarios"][0].update(mode="off"))
case("bad time", lambda b: b["scenarios"][0].update(time="24:00"))
case("bad time format", lambda b: b["scenarios"][0].update(time="9:30"))
case("minutes out of range", lambda b: b["scenarios"][0].update(time="09:60"))

for label, body in cases:
    status, text = put(body)
    check(f"rejects {label}", (422, INVALID), (status, text))

# A valid edge-case body is accepted.
edge = good()
edge["scenarios"][0]["time"] = "23:59"
edge["interviews"][0]["slug"] = "ab"
edge["interviews"][0]["name"] = "x" * 1200
status, _ = put(edge)
check("accepts edge values", 200, status)

# The sheet prints the published lines, in order, from the stored record.
sheet = good()
sheet["product"]["name"] = "Vireo Pace Nocturne"
sheet["product"]["format"] = "Drink stick, 7 g of powder"
sheet["product"]["serving"] = "One stick in 200 ml of water"
sheet["product"]["packs"] = [{"sticks": 100, "price_yen": 12345}]
sheet["product"]["ingredients"] = [{"name": "Red beet root powder", "mg": 3500}]
sheet["product"]["how_to_use"] = ["Tear open one stick.", "Stir it in."]
sheet["product"]["cautions"] = ["Ask your doctor.", "It can turn urine red."]
status, body = put(sheet)
edition = json.loads(body)["edition"]
check("sheet publish", 200, status)

with urllib.request.urlopen(f"{BASE}/api/product/sheet") as response:
    pdf = response.read()
open("/tmp/sheet.pdf", "wb").write(pdf)
check("pdf header", b"%PDF", pdf[:4])
text = subprocess.run(
    ["pdftotext", "-layout", "/tmp/sheet.pdf", "-"],
    capture_output=True,
    check=False,
).stdout.decode()
lines = [line.strip() for line in text.splitlines() if line.strip()]
want = [
    "Vireo Pace Nocturne product information",
    "Alder Quay Laboratories",
    "Format: Drink stick, 7 g of powder",
    "Serving: One stick in 200 ml of water",
    "100 sticks: ¥12,345 (tax included)",
    "Ingredients per stick",
    "Red beet root powder 3,500 mg",
    "How to use",
    "1. Tear open one stick.",
    "2. Stir it in.",
    "Storage: Keep sealed sticks away from direct sunlight, heat and damp.",
    "Cautions",
    "Ask your doctor.",
    "It can turn urine red.",
    "Vireo Pace Nocturne is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease.",
    f"Content edition {edition}",
]
check("sheet lines", want, lines)

status, body = request("DELETE", "/api/grading/content")
check("restore", (200, '{"edition":1}'), (status, body))
restored = json.loads(request("GET", "/api/content", key=None)[1])
check("restored edition", 1, restored["edition"])
check("restored product name", "Vireo Pace", restored["product"]["name"])
check("restored interviews", 6, len(restored["interviews"]))

print(f"\n{passed} passed, {failed} failed")
raise SystemExit(1 if failed else 0)
