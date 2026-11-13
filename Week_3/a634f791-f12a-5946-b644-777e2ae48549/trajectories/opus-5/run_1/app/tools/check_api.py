"""A developer check of the API behaviours this brief fixes."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173")
PASSWORD = "deku-demo-pw-2026"
failures: list[str] = []


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(NoRedirects)


def call(method, path, body=None, token=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with opener.open(request) as response:
            payload = response.read()
            return response.status, payload, dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(), dict(error.headers)


def body_of(payload):
    try:
        return json.loads(payload)
    except ValueError:
        return payload


def check(label, got, want):
    if got != want:
        failures.append(f"{label}: got {got!r}, wanted {want!r}")


def login(email):
    status, payload, _ = call("POST", "/api/auth/login", {"email": email, "password": PASSWORD})
    check(f"login {email}", status, 200)
    return body_of(payload)["token"]


def main() -> int:
    curator = login("curator@example.com")
    steward = login("steward@example.com")
    westhall = login("curator.westhall@example.com")

    # ---- an empty filter reads the same whatever the sector names
    regions = {}
    for sector in ("rail", "mining", "cold-chain", "nothing-here", "%00", "%ED%A0%80"):
        _, payload, _ = call("GET", f"/references?sector={sector}")
        page = payload.decode("utf-8", "replace")
        main = page.split("<main", 1)[1].split("</main>", 1)[0]
        regions[sector] = main.replace(sector, "")
    check("every empty filter reads alike", len(set(regions.values())), 1)

    status, payload, _ = call("POST", "/api/auth/login", {"email": "nobody@example.com", "password": "x"})
    check("unknown sign in", status, 401)
    check("unknown sign in body", payload, b'{"message": "The address or password is not right"}')

    status, payload, _ = call("GET", "/api/desk/references")
    check("desk needs a session", (status, body_of(payload)), (401, {"message": "Sign in to use the desk"}))

    status, payload, _ = call("GET", "/api/desk/references", token=curator)
    rows = body_of(payload)
    check("desk list length", len(rows), 5)
    check("desk list states", [r["state"] for r in rows],
          ["live", "live", "live", "draft", "withheld"])

    status, payload, _ = call("GET", "/api/desk/references/cold-store-automation", token=curator)
    check("other programme reference", (status, body_of(payload)), (404, {"message": "Not found"}))

    status, payload, _ = call("GET", "/api/desk/references", token=westhall)
    check("the other programme sees only its own", [r["slug"] for r in body_of(payload)],
          ["cold-store-automation"])
    status, payload, _ = call("GET", "/api/desk/enquiries", token=westhall)
    check("and only its own queue", [r["email"] for r in body_of(payload)], ["cold.buyer@example.com"])
    for method, path in (
        ("POST", "/api/desk/references/dairy-line-rebuild/publish"),
        ("POST", "/api/desk/references/dairy-line-rebuild/retire"),
        ("POST", "/api/desk/references/dairy-line-rebuild/preview"),
    ):
        status, payload, _ = call(method, path, token=westhall)
        check(f"{path} across programmes", (status, body_of(payload)), (404, {"message": "Not found"}))
    status, payload, _ = call("PUT", "/api/desk/order",
                              {"slug": "dairy-line-rebuild", "ordinal": 1}, token=westhall)
    check("an ordinal across programmes", (status, body_of(payload)), (404, {"message": "Not found"}))

    status, payload, _ = call("PUT", "/api/desk/references/quarry-conveyor-upgrade/clearance",
                              {"clearance_from": "2026-01-01", "clearance_until": "2027-01-01"}, token=curator)
    check("curator window", (status, body_of(payload)), (403, {"message": "Your account cannot do this"}))

    status, payload, _ = call("POST", "/api/desk/references/quarry-conveyor-upgrade/publish", token=curator)
    check("publish with no window", (status, body_of(payload)),
          (409, {"message": "Record a clearance window before publishing"}))

    status, payload, _ = call("PUT", "/api/desk/references/quarry-conveyor-upgrade/clearance",
                              {"clearance_from": "2026-01-01", "clearance_until": "2027-01-01"}, token=steward)
    check("steward window", status, 200)

    status, payload, _ = call("POST", "/api/desk/references/quarry-conveyor-upgrade/publish", token=curator)
    check("publish with no figure", (status, body_of(payload)),
          (409, {"message": "Add at least one result figure before publishing"}))

    status, payload, headers = call(
        "PATCH", "/api/desk/references/quarry-conveyor-upgrade",
        {"figures": [{"label": "Idlers instrumented", "value": "184"}], "published": True, "ordinal": 9},
        token=curator)
    check("patch figures", status, 200)
    check("clearance voided by figures", body_of(payload)["clearance_voided"], True)

    status, _, _ = call("POST", "/api/desk/references/quarry-conveyor-upgrade/publish", token=curator)
    check("publish after void", status, 409)

    call("PUT", "/api/desk/references/quarry-conveyor-upgrade/clearance",
         {"clearance_from": "2026-01-01", "clearance_until": "2027-01-01"}, token=steward)
    status, payload, _ = call("POST", "/api/desk/references/quarry-conveyor-upgrade/publish", token=curator)
    check("publish", (status, body_of(payload)), (200, {"slug": "quarry-conveyor-upgrade", "ordinal": 4}))

    status, payload, _ = call("GET", "/api/references")
    check("index after publish", [r["ordinal"] for r in body_of(payload)], [1, 2, 3, 4])

    status, payload, _ = call("PUT", "/api/desk/order", {"slug": "quarry-conveyor-upgrade", "ordinal": 1},
                              token=curator)
    check("move to first", body_of(payload)[0], {"slug": "quarry-conveyor-upgrade", "ordinal": 1})

    status, payload, _ = call("PUT", "/api/desk/order", {"slug": "quarry-conveyor-upgrade", "ordinal": 10**30},
                              token=curator)
    check("move past the end", body_of(payload)[-1]["slug"], "quarry-conveyor-upgrade")

    status, payload, _ = call("PUT", "/api/desk/order", {"slug": "quarry-conveyor-upgrade", "ordinal": "2"},
                              token=curator)
    check("ordinal as text", status, 422)
    check("ordinal key", list(body_of(payload)["errors"]), ["ordinal"])

    status, payload, _ = call("PUT", "/api/desk/order", {"slug": "rail-depot-signalling", "ordinal": 1},
                              token=curator)
    check("move a withheld reference", (status, body_of(payload)),
          (409, {"message": "Only a live reference can be moved"}))

    status, payload, _ = call("POST", "/api/desk/references", {
        "title": "Harbour crane retrofit", "sector": "ports", "customer": "Kiela Terminals",
        "summary": "s", "challenge": "c", "work": "w"}, token=curator)
    check("clashing slug", (status, body_of(payload)), (201, {"slug": "harbour-crane-retrofit-2"}))

    status, payload, _ = call("POST", "/api/desk/references", {
        "title": "!!!", "sector": "ports", "customer": "x",
        "summary": "s", "challenge": "c", "work": "w"}, token=curator)
    check("empty slug", status, 422)
    check("empty slug key", list(body_of(payload)["errors"]), ["title"])

    status, payload, _ = call("POST", "/api/desk/references/harbour-crane-retrofit-2/preview", token=curator)
    token = body_of(payload)["token"]
    check("mint preview", status, 201)
    check("token length", len(token) >= 32, True)

    status, _, headers = call("GET", f"/api/references/harbour-crane-retrofit-2?preview={token}")
    check("preview read", status, 200)
    check("preview cache", headers.get("Cache-Control"), "private, no-store")
    check("preview robots", headers.get("X-Robots-Tag"), "noindex")

    status, payload, _ = call("GET", f"/api/references/dairy-line-rebuild?preview={token}")
    check("preview on another slug is ignored for a live reference", status, 200)

    status, payload, _ = call("GET", "/api/references/harbour-crane-retrofit-2?preview=%00")
    check("hostile preview token", (status, body_of(payload)), (404, {"message": "Not found"}))

    status, payload, _ = call("POST", "/api/desk/references/harbour-crane-retrofit-2/preview",
                              {"expires_at": "2027-01-01T00:00:00Z"}, token=curator)
    check("expiry past the limit", status, 422)
    check("expiry key", list(body_of(payload)["errors"]), ["expires_at"])

    status, payload, _ = call("POST", "/api/desk/references/harbour-crane-retrofit-2/preview",
                              {"expires_at": "20270101"}, token=curator)
    check("loose expiry", status, 422)

    status, payload, _ = call("POST", "/api/desk/references/harbour-crane-retrofit-2/preview",
                              token=curator)
    check("re-mint", status, 201)
    status, payload, _ = call("GET", f"/api/references/harbour-crane-retrofit-2?preview={token}")
    check("replaced link is dead", (status, body_of(payload)), (404, {"message": "Not found"}))

    status, payload, _ = call("POST", "/api/enquiries", {"email": "a@b.com", "agreed": True})
    first = body_of(payload)["id"]
    check("enquiry accepted", status, 201)
    status, payload, _ = call("POST", "/api/enquiries", {"email": " A@B.COM ", "agreed": True})
    check("repeat joins the open enquiry", body_of(payload)["id"], first)

    status, payload, _ = call("POST", "/api/enquiries", {"email": "bad", "agreed": False, "phone": "123",
                                                         "reference": "nope"})
    check("enquiry refused", status, 422)
    check("enquiry error keys", sorted(body_of(payload)["errors"]), ["agreed", "email", "phone", "reference"])

    status, payload, _ = call("GET", "/api/desk/enquiries", token=curator)
    queue = body_of(payload)
    check("queue holds one row per address", sum(1 for r in queue if r["email"] == "a@b.com"), 1)

    status, payload, _ = call("DELETE", f"/api/desk/enquiries/{first}", token=curator)
    check("curator cannot delete", (status, body_of(payload)), (403, {"message": "Your account cannot do this"}))
    status, _, _ = call("DELETE", f"/api/desk/enquiries/{first}", token=steward)
    check("steward deletes", status, 204)
    status, payload, _ = call("DELETE", f"/api/desk/enquiries/{first}", token=steward)
    check("second delete", (status, body_of(payload)), (404, {"message": "Not found"}))
    status, payload, _ = call("DELETE", "/api/desk/enquiries/not-a-number", token=steward)
    check("non integer enquiry", (status, body_of(payload)), (404, {"message": "Not found"}))

    status, payload, headers = call("POST", "/api/references")
    check("wrong method", (status, body_of(payload)), (405, {"message": "Method not allowed"}))
    check("allow header", headers.get("Allow"), "GET, HEAD")
    status, _, headers = call("POST", "/api/desk/references/x", token=curator)
    check("allow on the detail path", headers.get("Allow"), "GET, HEAD, PATCH")

    for path in ("/api/docs", "/api/openapi.json", "/api/schema", "/api/debug", "/api/signup",
                 "/api/auth/signup", "/api/search", "/api/checkout", "/api/comments",
                 "/api/notes/comments", "/api/reactions"):
        status, payload, _ = call("GET", path)
        check(f"unlisted {path}", (status, body_of(payload)), (404, {"message": "Not found"}))

    status, payload, _ = call("POST", "/api/enquiries", raw=b"[1,2,3]")
    check("array body", (status, body_of(payload)), (422, {"errors": {"body": "Send a JSON object"}}))
    status, payload, _ = call("POST", "/api/enquiries", raw=b'{"email": NaN}')
    check("NaN body", (status, body_of(payload)), (422, {"errors": {"body": "Send a JSON object"}}))
    status, payload, _ = call("POST", "/api/enquiries", raw=b"[" * 60000)
    check("deep body", (status, body_of(payload)), (422, {"errors": {"body": "Send a JSON object"}}))
    status, payload, _ = call("POST", "/api/enquiries", raw=b"{" + b"x" * 70000 + b"}")
    check("oversize body", (status, body_of(payload)), (413, {"message": "Request body too large"}))
    status, payload, _ = call("POST", "/api/enquiries", raw=b'{"email":"\xff\xfe","agreed":true}')
    check("invalid utf-8", (status, body_of(payload)), (422, {"errors": {"body": "Send a JSON object"}}))
    status, payload, _ = call("POST", "/api/desk/references",
                              raw=b'{"title":"a\\u0000b"}', token=curator)
    check("NUL in a field", status, 422)
    check("NUL key", "title" in body_of(payload)["errors"], True)

    status, payload, _ = call("PATCH", "/api/desk/references/harbour-crane-retrofit",
                              {"title": "Harbour crane rebuild"}, token=curator,
                              headers={"If-Match": '"999"'})
    check("stale If-Match", (status, body_of(payload)),
          (412, {"message": "This reference has changed since you opened it"}))

    status, payload, _ = call("GET", "/api/desk/references/harbour-crane-retrofit", token=curator)
    version = body_of(payload)["version"]
    status, payload, _ = call("PATCH", "/api/desk/references/harbour-crane-retrofit",
                              {"title": "Harbour crane rebuild"}, token=curator,
                              headers={"If-Match": f'"{version}"'})
    check("rename", (status, body_of(payload)["slug"]), (200, "harbour-crane-rebuild"))

    status, _, headers = call("GET", "/api/references/harbour-crane-retrofit?sector=food&x=a%20b")
    check("api redirect", status, 308)
    check("api redirect target", headers.get("Location"),
          "/api/references/harbour-crane-rebuild?sector=food&x=a%20b")

    status, _, headers = call("GET", "/references/harbour-crane-retrofit")
    check("page redirect", (status, headers.get("Location")), (308, "/references/harbour-crane-rebuild"))
    status, _, headers = call("GET", "/fi/references/harbour-crane-retrofit")
    check("finnish redirect", (status, headers.get("Location")), (308, "/fi/references/harbour-crane-rebuild"))

    call("PATCH", "/api/desk/references/harbour-crane-rebuild",
         {"title": "Harbour crane retrofit"}, token=curator)
    status, _, headers = call("GET", "/api/references/harbour-crane-rebuild")
    check("rename back", (status, headers.get("Location")), (308, "/api/references/harbour-crane-retrofit"))

    status, _, _ = call("POST", "/api/desk/references/harbour-crane-retrofit/retire", token=curator)
    check("retire", status, 200)
    status, payload, _ = call("GET", "/api/references/harbour-crane-rebuild")
    check("earlier slug of a retired reference", (status, body_of(payload)), (404, {"message": "Not found"}))
    status, payload, _ = call("GET", "/api/references")
    check("run closed up", [r["ordinal"] for r in body_of(payload)], [1, 2, 3])

    status, payload, _ = call("POST", "/api/desk/references/harbour-crane-retrofit/publish", token=curator)
    check("restore lands last", body_of(payload)["ordinal"], 4)

    status, payload, _ = call("GET", "/api/fi/references/harbour-crane-retrofit")
    detail = body_of(payload)
    check("finnish title", detail["title"], "Satamanosturin modernisointi")
    check("finnish translated", detail["translated"], True)
    status, payload, _ = call("GET", "/api/fi/references/dairy-line-rebuild")
    check("untranslated", body_of(payload)["translated"], False)
    check("untranslated title", body_of(payload)["title"], "Dairy line rebuild")

    for path in ("/fi/fi/references", "/fi/desk"):
        status, _, _ = call("GET", path)
        check(f"doubled address {path}", status, 404)

    status, payload, _ = call("GET", "/api/references?sector=mining&sector=food")
    check("repeated sector uses the first", [r["sector"] for r in body_of(payload)], ["mining"])
    status, payload, _ = call("GET", "/api/references?sector=%00")
    check("hostile sector", body_of(payload), [])
    status, payload, _ = call("GET", "/api/references?sector=cold-chain")
    check("other programme sector", body_of(payload), [])

    # ---- no route reads out the service clock
    for path in (
        "/api/health",
        "/api/references",
        "/api/sectors",
        "/api/notes",
        "/api/desk/references",
        "/api/desk/enquiries",
        "/",
        "/references",
        "/contact",
        "/desk",
    ):
        token = curator if path.startswith("/api/desk") else None
        _, payload, _ = call("GET", path, token=token)
        text = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        for word in (b"offset_seconds", b"service_clock"):
            check(f"{path} keeps {word.decode()} to itself", word in text, False)

    # ---- the desk sorts its non-live rows in Finnish alphabetical order
    for title in ("Zinc", "abc", "\u00c5land", "\u00c4mm\u00e4", "\u00d6ljy", "Ankkuri"):
        call(
            "POST",
            "/api/desk/references",
            {
                "title": title,
                "sector": "metals",
                "customer": "Sorting",
                "summary": "s",
                "challenge": "c",
                "work": "w",
            },
            token=curator,
        )
    sorted_titles = ("abc", "Ankkuri", "Zinc", "\u00c5land", "\u00c4mm\u00e4", "\u00d6ljy")
    status, payload, _ = call("GET", "/api/desk/references", token=curator)
    resting = [row["title"] for row in body_of(payload) if not row["live"]]
    check(
        "finnish alphabetical order",
        [title for title in resting if title in sorted_titles],
        list(sorted_titles),
    )
    check("live rows come first", [row["live"] for row in body_of(payload)][:3], [True, True, True])

    if failures:
        print("\n".join(failures))
        print(f"\n{len(failures)} check(s) failed")
        return 1
    print("all API checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
