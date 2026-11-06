"""Black-box verification of the Ivo Kastrel API against a running server."""
import json
import uuid
import concurrent.futures as futures
import sys
import urllib.request
import urllib.error

BASE = "http://127.0.0.1:4173"
OWNER = {"email": "owner@example.com", "password": "deku-demo-pw-2026"}

passed = failed = 0


def call(path, method="GET", body=None, token=None, content_type="application/json", raw_body=None):
    url = BASE + path
    data = None
    if raw_body is not None:
        data = raw_body if isinstance(raw_body, bytes) else raw_body.encode()
    elif body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", content_type)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req) as response:
            payload = response.read()
            return response.status, dict(response.headers), payload
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
    else:
        failed += 1
        print(f"FAIL: {name} {detail}")


def jparse(payload):
    try:
        return json.loads(payload)
    except Exception:
        return None


def section(title):
    print(f"— {title}")


def main():
    section("health and seed")
    status, _, body = call("/api/health")
    check("health 200", status == 200 and jparse(body) == {"status": "ok"}, body[:100])

    status, _, body = call("/api/cases")
    cases = jparse(body)
    check("cases list 200", status == 200 and isinstance(cases, list), body[:200])
    check("five published case studies", len(cases) == 5, len(cases))
    check("ordinals 01..05", [c["ordinal"] for c in cases] == ["01", "02", "03", "04", "05"],
          [c.get("ordinal") for c in cases])
    check("catalogue order", [c["slug"] for c in cases] ==
          ["hollow-signal", "ember-ledger", "night-cartography", "vanta-atelier", "low-tide-radio"],
          [c["slug"] for c in cases])
    check("draft absent", all(c["slug"] != "red-meridian" for c in cases))

    section("discipline filter (DP-35)")
    for value, count in (("3d-web", 2), ("ui-ux", 2), ("frontend", 1)):
        status, _, body = call(f"/api/cases?discipline={value}")
        rows = jparse(body)
        check(f"filter {value}", status == 200 and len(rows) == count, (status, body[:120]))
    status, _, body = call("/api/cases?discipline=nope")
    check("unknown discipline 422", status == 422 and jparse(body)["errors"]["discipline"], body[:150])
    status, _, body = call("/api/cases?discipline=ui-ux&discipline=3d-web")
    check("repeated discipline 422", status == 422, status)
    status, _, body = call("/api/cases?discipline=")
    check("empty discipline 422", status == 422, status)
    status, _, body = call("/api/cases?page=3&foo=bar")
    check("other params ignored (DP-13)", status == 200 and len(jparse(body)) == 5, status)

    section("case study place and neighbours (DP-34)")
    status, _, body = call("/api/cases/hollow-signal")
    one = jparse(body)
    check("hollow-signal 200", status == 200, status)
    check("place 01/05", one["ordinal"] == "01" and one["total"] == "05", (one["ordinal"], one["total"]))
    check("fields present", all(k in one for k in
          ("challenge", "approach", "outcome", "stack", "featured", "previous", "next")))
    check("next is ember-ledger", one["next"]["slug"] == "ember-ledger")
    check("previous wraps to low-tide-radio", one["previous"]["slug"] == "low-tide-radio")
    status, _, body = call("/api/cases/low-tide-radio")
    check("last case next wraps to first", jparse(body)["next"]["slug"] == "hollow-signal")

    section("draft and not-found identical (DP-11, DP-12)")
    draft = call("/api/cases/red-meridian")
    unknown = call("/api/cases/never-existed")
    check("draft 404 == unknown 404", draft[0] == unknown[0] == 404 and draft[2] == unknown[2],
          (draft[0], unknown[0]))
    check("no path echoed", b"red-meridian" not in draft[2] and b"never" not in unknown[2])
    for variant in ("Hollow-Signal", "hollow-signal/", "hollow%2dsignal", "1"):
        status, _, _ = call(f"/api/cases/{variant}")
        check(f"slug variant {variant} 404", status == 404, status)

    section("journal (DP-39, DP-40)")
    status, _, body = call("/api/journal")
    entries = jparse(body)
    check("three public entries", status == 200 and len(entries) == 3, len(entries))
    check("newest first", [e["published_on"] for e in entries] ==
          ["2026-07-01", "2026-06-14", "2026-05-22"], [e["published_on"] for e in entries])
    status, _, body = call("/api/journal/unfinished-light")
    unknown = call("/api/journal/never-existed")
    check("unpublished entry 404 identical", status == unknown[0] == 404 and body == unknown[2],
          (status, unknown[0]))
    status, _, body = call("/api/journal/motion-beyond-animation")
    entry = jparse(body)
    check("journal entry 200 with body", status == 200 and "body" in entry and entry["excerpt"])

    section("recognitions and figures")
    status, _, body = call("/api/recognitions")
    rows = jparse(body)
    check("three recognitions", status == 200 and len(rows) == 3 and rows[0]["award"] == "Developer Award")
    status, _, body = call("/api/figures")
    rows = jparse(body)
    check("three figures", status == 200 and len(rows) == 3 and rows[0]["value"] == "10+")

    section("auth (DP-01..DP-06)")
    status, _, body = call("/api/auth/login", "POST", OWNER)
    token = jparse(body)["token"] if status == 200 else None
    check("login 200 with token", status == 200 and token and len(token) >= 16, (status, body[:120]))

    wrong = call("/api/auth/login", "POST", {"email": OWNER["email"], "password": "wrong"})
    unknown_email = f"nobody-{uuid.uuid4().hex[:8]}@example.com"
    unknown = call("/api/auth/login", "POST", {"email": unknown_email, "password": "x"})
    check("wrong and unknown identical (DP-02)",
          wrong[0] == unknown[0] == 401 and wrong[2] == unknown[2], (wrong[0], unknown[0]))

    status, _, body = call("/api/studio/cases")
    check("studio read needs token (DP-08)", status == 401, status)
    status, _, body = call("/api/studio/cases", token="forged-token")
    check("forged token refused", status == 401, status)
    status, _, body = call("/api/studio/cases", token=token, body={"role": "owner"}, method="POST")
    check("body role grants nothing", status in (401, 422), status)

    status, _, body = call("/api/studio/cases", token=token)
    rows = jparse(body)
    check("studio sees six rows", status == 200 and len(rows) == 6, (status, len(rows) if rows else body[:100]))
    check("studio row fields", rows and set(rows[0]) == {
        "id", "slug", "title", "discipline", "summary", "challenge", "approach", "outcome",
        "stack", "year", "featured", "position", "published", "published_at", "created_at",
        "updated_at"}, set(rows[0]) if rows else None)

    section("studio case lifecycle (DP-17..DP-21)")
    status, _, body = call("/api/studio/cases", "POST", {
        "slug": "test-draft", "title": "Test Draft", "discipline": "ui-ux",
        "year": 2026, "position": 7}, token=token)
    row = jparse(body)
    check("create 201 draft", status == 201 and row["published"] is False and row["published_at"] is None,
          (status, body[:150]))
    draft_id = row["id"]
    status, _, body = call("/api/cases")
    check("new draft absent publicly (DP-17)", all(c["slug"] != "test-draft" for c in jparse(body)))

    status, _, body = call(f"/api/studio/cases/{draft_id}/publish", "POST",
                           {"published": False}, token=token)
    check("unpublish a draft 409 (DP-19)", status == 409 and jparse(body)["error"] ==
          "This case study is already a draft.", (status, body[:120]))

    status, _, body = call(f"/api/studio/cases/{draft_id}/publish", "POST",
                           {"published": True}, token=token)
    check("publish without summary refused (DP-20)", status == 422 and
          jparse(body)["errors"]["summary"] == "Add a summary before publishing.", body[:150])

    call(f"/api/studio/cases/{draft_id}", "PATCH", {"summary": "A test summary."}, token=token)
    call(f"/api/studio/cases/{draft_id}", "PATCH", {"outcome": "A test outcome."}, token=token)
    status, _, body = call(f"/api/studio/cases/{draft_id}/publish", "POST",
                           {"published": True}, token=token)
    check("publish ok", status == 200 and jparse(body)["published_at"] is not None, body[:150])
    stamped = jparse(body)["published_at"]
    status, _, body = call(f"/api/studio/cases/{draft_id}/publish", "POST",
                           {"published": True}, token=token)
    check("publish published 409", status == 409 and jparse(body)["error"] ==
          "This case study is already published.", (status, body[:120]))

    status, _, body = call("/api/cases")
    check("published draft appears with ordinal 06", any(
        c["slug"] == "test-draft" and c["ordinal"] == "06" for c in jparse(body)))

    status, _, body = call(f"/api/studio/cases/{draft_id}/publish", "POST",
                           {"published": False}, token=token)
    check("unpublish ok clears published_at", status == 200 and jparse(body)["published_at"] is None,
          body[:150])
    status, _, body = call("/api/cases")
    check("unpublished gone from public reads", all(c["slug"] != "test-draft" for c in jparse(body)))
    check("totals back to five", len(jparse(body)) == 5)

    status, _, body = call(f"/api/studio/cases/{draft_id}", "PATCH", {"title": "Edited Title"}, token=token)
    check("edit title ok", status == 200 and jparse(body)["title"] == "Edited Title", body[:120])
    status, _, body = call(f"/api/studio/cases/{draft_id}", "DELETE", token=token)
    check("delete 204", status == 204, status)
    status, _, _ = call(f"/api/studio/cases/{draft_id}", "PATCH", {"title": "x"}, token=token)
    check("deleted row gone", status == 404, status)

    section("validation (DP-26..DP-30)")
    bad = {
        "slug": "Bad Slug", "title": "x" * 81, "discipline": "nope", "year": 1800,
        "position": 0, "summary": "s" * 201, "featured": "yes",
    }
    status, _, body = call("/api/studio/cases", "POST", bad, token=token)
    errors = jparse(body)["errors"]
    check("one validation answer names all fields", status == 422 and set(errors) == set(bad),
          (status, sorted(errors) if errors else body[:200]))

    status, _, body = call("/api/studio/cases", "POST", {
        "slug": "ok-slug", "title": "Ok", "discipline": "ui-ux", "year": 2026, "position": 8,
        "published": True}, token=token)
    check("refused key published (DP-28)", status == 422 and
          jparse(body)["errors"]["published"] == "This field cannot be set.", body[:150])
    status, _, body = call("/api/studio/cases", "POST", {
        "slug": "ok-slug", "title": "Ok", "discipline": "ui-ux", "year": 2026, "position": 8}, token=token)
    ok_id = jparse(body)["id"]
    status, _, body = call("/api/studio/cases", "POST", {
        "slug": "ok-slug", "title": "Ok", "discipline": "ui-ux", "year": 2026, "position": 9}, token=token)
    check("slug conflict 409 (DP-29)", status == 409 and jparse(body)["error"] ==
          "That slug is already in use.", (status, body[:120]))
    status, _, body = call(f"/api/studio/cases/{ok_id}", "PATCH", {"slug": "new-slug"}, token=token)
    check("slug on edit refused", status == 422 and jparse(body)["errors"]["slug"] ==
          "This field cannot be set.", body[:150])
    status, _, body = call(f"/api/studio/cases/{ok_id}", "PATCH", {}, token=token)
    check("empty edit refused", status == 422 and jparse(body)["errors"]["body"] ==
          "Send at least one field to change.", (status, body[:150]))
    status, _, body = call(f"/api/studio/cases/{ok_id}", "DELETE", token=token)
    check("cleanup ok-slug", status == 204, status)

    status, _, body = call("/api/studio/cases", "POST", {
        "slug": "draft-2026-x", "title": "Digits Slug", "discipline": "ui-ux",
        "year": 2026, "position": 12}, token=token)
    ok = status == 201
    check("slug with digits accepted", ok, (status, body[:150]))
    if ok:
        call("/api/studio/cases/" + str(jparse(body)["id"]), "DELETE", token=token)

    slug_variants = ["Bad-Slug", "bad slug", "-bad", "bad-", "bad--slug", "bad_slug", "", "b" * 65]
    for variant in slug_variants:
        status, _, body = call("/api/studio/cases", "POST", {
            "slug": variant, "title": "S", "discipline": "ui-ux", "year": 2026, "position": 9}, token=token)
        ok = status == 422 and "slug" in jparse(body)["errors"]
        check(f"slug variant refused: {variant[:20]!r}", ok, (status, body[:120]))

    section("concurrency (DP-19, DP-30, DP-49, DP-50)")
    status, _, body = call("/api/studio/cases", "POST", {
        "slug": "race-draft", "title": "Race", "discipline": "ui-ux", "year": 2026,
        "position": 10, "summary": "S", "outcome": "O"}, token=token)
    race_id = jparse(body)["id"]
    with futures.ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: call(
            f"/api/studio/cases/{race_id}/publish", "POST", {"published": True}, token=token),
            range(4)))
    codes = sorted(r[0] for r in results)
    check("four publishes: one 200 three 409", codes == [200, 409, 409, 409], codes)
    call(f"/api/studio/cases/{race_id}", "DELETE", token=token)

    with futures.ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: call("/api/studio/cases", "POST", {
            "slug": "same-slug", "title": "Same", "discipline": "ui-ux", "year": 2026,
            "position": 11}, token=token), range(4)))
    codes = sorted(r[0] for r in results)
    check("four creates: one 201 three 409", codes == [201, 409, 409, 409], codes)
    status, _, body = call("/api/studio/cases", token=token)
    same = [r for r in jparse(body) if r["slug"] == "same-slug"]
    check("one row for same-slug", len(same) == 1)
    call(f"/api/studio/cases/{same[0]['id']}", "DELETE", token=token)

    section("inquiries (DP-42..DP-49)")
    run_id = uuid.uuid4().hex[:8]
    inquiry = {"name": "Ada Test", "phone": "+64 21 555 0199", "email": "Ada@Test.Dev",
               "message": f"I have a launch film in mind for spring. Ref {run_id}."}
    status, _, body = call("/api/inquiries", "POST", inquiry)
    row = jparse(body)
    check("inquiry 201 with id and status", status == 201 and row["status"] == "new" and row["id"],
          (status, body[:120]))
    inquiry_id = row["id"]

    dup = dict(inquiry, message=inquiry["message"] + " ")
    status, _, body = call("/api/inquiries", "POST", dup)
    check("duplicate returns 200 same id", status == 200 and jparse(body)["id"] == inquiry_id,
          (status, body[:120]))

    diff = dict(inquiry, message=f"A different message entirely, thanks. Ref {run_id}.")
    status, _, body = call("/api/inquiries", "POST", diff)
    check("different message is new inquiry", status == 201 and jparse(body)["id"] != inquiry_id)

    with futures.ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: call("/api/inquiries", "POST", {
            "name": "Sam Race", "phone": "+64 9 555 0123", "email": "sam@race.dev",
            "message": f"Four of us sent the very same note. Ref {run_id}."}), range(4)))
    ids = {jparse(r[2])["id"] for r in results if r[0] in (200, 201)}
    check("simultaneous duplicates one id", len(ids) == 1, ids)

    bad_inquiry = {"name": "", "phone": "abc", "email": "not-an-email",
                   "message": "short", "project_type": "wrong", "extra": "x"}
    status, _, body = call("/api/inquiries", "POST", bad_inquiry)
    errors = jparse(body)["errors"]
    check("inquiry validation names all fields", status == 422 and set(errors) == set(bad_inquiry),
          (status, sorted(errors) if errors else body[:200]))

    hostile_email = "a" * 20000 + "@sub.example.com"
    import time
    start = time.time()
    status, _, body = call("/api/inquiries", "POST", {
        "name": "Hostile", "phone": "+64 21 555 0100", "email": hostile_email,
        "message": "A hostile long email should be refused quickly."})
    elapsed = time.time() - start
    check("hostile email refused within 2s (DP-45)",
          status == 422 and jparse(body)["errors"]["email"] == "Enter a valid email address."
          and elapsed < 2, (status, round(elapsed, 2)))

    section("inquiry inbox and resolve (DP-50)")
    status, _, body = call("/api/studio/inquiries", token=token)
    rows = jparse(body)
    check("owner lists inquiries newest first", status == 200 and len(rows) >= 3 and
          rows[0]["received_at"] >= rows[-1]["received_at"], (status, len(rows)))
    newest = next((r for r in rows if r["status"] == "new"), None)
    check("a new inquiry exists to resolve", newest is not None, rows[:1])
    check("inquiry fields", newest is not None and set(newest) == {"id", "name", "phone", "email",
          "message", "project_type", "status", "received_at", "resolved_at"},
          set(newest) if newest else None)
    if newest is not None:
        status, _, body = call(f"/api/studio/inquiries/{newest['id']}/resolve", "POST", token=token)
        check("resolve 200 stamps resolved_at", status == 200 and jparse(body)["resolved_at"], body[:150])
        with futures.ThreadPoolExecutor(4) as pool:
            results = list(pool.map(lambda _: call(
                f"/api/studio/inquiries/{newest['id']}/resolve", "POST", token=token), range(4)))
        codes = sorted(r[0] for r in results)
        check("resolve conflict on resolved", codes == [409, 409, 409, 409], codes)

    section("malformed requests (DP-44)")
    status, _, body = call("/api/inquiries", "POST", raw_body=b"{bad json", token=None)
    check("invalid JSON 400", status == 400 and jparse(body)["error"] ==
          "The request body is not a JSON object.", (status, body[:120]))
    status, _, body = call("/api/inquiries", "POST", raw_body=b"[1,2,3]")
    check("non-object JSON 400", status == 400, status)
    status, _, body = call("/api/inquiries", "POST", raw_body=b"x" * 33000)
    check("oversized body 413", status == 413 and jparse(body)["error"] ==
          "The request body is larger than 32,768 bytes.", (status, body[:120]))
    status, _, body = call("/api/inquiries", "POST", body={"name": "A"}, content_type="text/plain")
    check("non-JSON content type 415", status == 415, status)

    section("banned and wrong methods (DP-15)")
    for banned in ("/api/auth/signup", "/api/cart", "/api/checkout", "/api/newsletter", "/api/search"):
        status, _, body = call(banned, "POST", {})
        check(f"{banned} 404", status == 404 and jparse(body)["error"] == "Not found.", (status, body[:100]))
    status, headers, body = call("/api/cases", "DELETE")
    check("wrong method 405 with Allow", status == 405 and jparse(body)["error"] == "Method not allowed."
          and "Allow" in headers, (status, headers.get("Allow")))
    status, _, body = call("/api/definitely-not-a-route")
    check("unknown api route 404 JSON", status == 404 and jparse(body)["error"] == "Not found.",
          (status, body[:100]))

    section("never served")
    for path in ("/app.py", "/run.json", "/requirements.txt", "/.env", "/db.py"):
        status, _, _ = call(path)
        check(f"{path} not served", status == 404, status)

    section("public pages")
    for path, marker in (("/", "IT WAS ALWAYS GOING TO BE THIS WAY"),
                         ("/work", "Discipline filter"),
                         ("/work/hollow-signal", "01 / 05"),
                         ("/journal", "Motion Beyond Animation"),
                         ("/journal/motion-beyond-animation", "July 1, 2026"),
                         ("/contact", "GET IN TOUCH"),
                         ("/studio/login", "Sign in"),
                         ("/studio", "Studio")):
        status, _, body = call(path)
        ok = status == 200 and marker.encode() in body
        check(f"page {path}", ok, (status, marker if status != 200 else "marker missing"))
    for path in ("/work/red-meridian", "/journal/unfinished-light", "/work/hollow-signal/"):
        status, _, body = call(path)
        check(f"{path} 404 page", status == 404 and b"Nothing at this address." in body, status)
    status, _, body = call("/nope-nope")
    check("unknown page shows 404 with chrome",
          status == 404 and b"Nothing at this address." in body and b"Ivo Kastrel" in body, status)
    status, _, body = call("/work?discipline=nope")
    check("bad discipline redirects to /work", status == 302, status)

    section("studio HTML carries no data (DP-10)")
    status, _, body = call("/studio")
    html = body.decode()
    check("studio html has no case titles", "Hollow Signal" not in html and "red-meridian" not in html)
    check("studio html has no inquiries", "Ada Test" not in html)

    section("sign-out ends the token (DP-06)")
    status, _, body = call("/api/auth/logout", "POST", token=token)
    check("logout 204", status == 204, status)
    status, _, _ = call("/api/studio/cases", token=token)
    check("token refused after logout", status == 401, status)
    status, _, _ = call("/api/auth/logout", "POST", token=token)
    check("logout with revoked token refused", status == 401, status)

    section("lockout (DP-04, DP-05)")
    lock_email = f"lock-{uuid.uuid4().hex[:8]}@example.com"
    for i in range(5):
        call("/api/auth/login", "POST", {"email": lock_email, "password": "nope"})
    status, headers, body = call("/api/auth/login", "POST", {"email": lock_email,
                                                         "password": "correct-horse"})
    check("locked unknown email 429", status == 429 and jparse(body)["error"] ==
          "Too many sign-in attempts. Try again later.", (status, body[:120]))
    check("Retry-After header", "Retry-After" in headers and 1 <= int(headers["Retry-After"]) <= 900,
          headers.get("Retry-After"))
    right = call("/api/auth/login", "POST", {"email": lock_email, "password": "correct-horse"})
    check("even right password refused while locked", right[0] == 429, right[0])

    print()
    print(f"passed {passed}, failed {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
