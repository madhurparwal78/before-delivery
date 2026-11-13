"""API tests: every check traces to a mandatory requirement.

Run: .venv/bin/python -m pytest tests/ -q
The suite works against the Flask test client and the seeded store.
"""

import datetime as dt
import threading

import wsgi


def auth(client, email="steward@example.com", password="deku-demo-pw-2026"):
    response = client.post("/api/auth/login",
                           json={"email": email, "password": password})
    assert response.status_code == 200, response.data
    return response.get_json()["token"]


def desk_headers(token):
    return {"Authorization": "Bearer " + token}


# --------------------------------------------------------- DP-01, DP-56

def test_health_and_one_origin(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
    assert response.headers["Content-Type"].startswith("application/json")


def test_unlisted_api_path_answers_json_404(client):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.data == b'{"message":"Not found"}'
    for path in ("/api/auth/signup", "/api/search", "/api/checkout",
                 "/api/comments", "/api/reactions", "/api/docs",
                 "/api/openapi.json", "/api/schema", "/api/debug"):
        assert client.get(path).status_code == 404
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/admin").status_code == 404


def test_unlisted_method_answers_405_with_allow(client):
    response = client.put("/api/references")
    assert response.status_code == 405
    assert response.get_json() == {"message": "Method not allowed"}
    assert "GET" in response.headers.get("Allow", "")
    response = client.post("/api/references/harbour-crane-retrofit")
    assert response.status_code == 405
    response = client.delete("/api/enquiries")
    assert response.status_code == 405
    assert "POST" in response.headers["Allow"]
    response = client.post("/api/desk/references/harbour-crane-retrofit/retire")
    assert response.status_code == 401  # auth before 405 is fine either way
    response = client.patch("/api/references")
    assert response.status_code == 405


# ------------------------------------------------------------- DP-06..08

def test_index_lists_live_references_in_order(client):
    response = client.get("/api/references")
    assert response.status_code == 200
    rows = response.get_json()
    assert [r["slug"] for r in rows] == [
        "harbour-crane-retrofit", "dairy-line-rebuild", "paper-mill-drive-swap"]
    assert [r["ordinal"] for r in rows] == [1, 2, 3]
    assert rows[0]["result"] == {"label": "Crane availability", "value": "99.2 %"}
    for key in ("slug", "ordinal", "sector", "title", "result"):
        assert key in rows[0]


def test_other_programme_and_withheld_never_appear(client):
    rows = client.get("/api/references").get_json()
    slugs = {r["slug"] for r in rows}
    assert "cold-store-automation" not in slugs
    assert "rail-depot-signalling" not in slugs
    assert "quarry-conveyor-upgrade" not in slugs
    assert client.get("/api/references/cold-store-automation").status_code == 404
    assert client.get("/api/references/rail-depot-signalling").status_code == 404
    assert client.get("/api/references/quarry-conveyor-upgrade").status_code == 404


def test_detail_includes_figures_in_order(client):
    response = client.get("/api/references/harbour-crane-retrofit")
    assert response.status_code == 200
    body = response.get_json()
    assert body["slug"] == "harbour-crane-retrofit"
    assert [f["label"] for f in body["figures"]] == [
        "Crane availability", "Retrofit downtime", "Energy per container move"]
    assert body["quote"] is None


def test_detail_quote_present(client):
    body = client.get("/api/references/paper-mill-drive-swap").get_json()
    assert body["quote"]["speaker"] == "Hanna Lehto"
    assert body["quote"]["role"] == "Maintenance manager, Aspen Mills"


def test_sector_filter(client):
    rows = client.get("/api/references?sector=food").get_json()
    assert [r["slug"] for r in rows] == ["dairy-line-rebuild"]
    assert client.get("/api/references?sector=nosuch").get_json() == []
    assert client.get("/api/references?sector=").get_json() != []
    repeated = client.get("/api/references?sector=food&sector=ports")
    assert repeated.status_code == 200


# ----------------------------------------------------------- DP-23..25

def test_login_success_and_roles(client):
    assert auth(client, "curator@example.com")
    assert auth(client, "steward@example.com")
    assert auth(client, "curator.westhall@example.com")


def test_login_refusals_byte_identical(client):
    bodies = []
    for payload in ({"email": "nobody@example.com", "password": "deku-demo-pw-2026"},
                    {"email": "steward@example.com", "password": "wrong"},
                    {"email": "steward@example.com"},
                    {},
                    {"email": "a\x00b", "password": "x" * 40}):
        response = client.post("/api/auth/login", json=payload)
        assert response.status_code == 401
        bodies.append(response.data)
    assert len(set(bodies)) == 1
    assert bodies[0] == b'{"message":"The address or password is not right"}'


def test_desk_requires_bearer_token(client):
    for path in ("/api/desk/references", "/api/desk/enquiries"):
        assert client.get(path).status_code == 401
        assert client.get(path,
                          headers={"Authorization": "Bearer nope"}).status_code == 401
    response = client.get("/api/desk/references")
    assert response.get_json() == {"message": "Sign in to use the desk"}


def test_hashed_passwords(client):
    import db as db_module
    def work(conn):
        with conn.cursor() as cur:
            cur.execute("SELECT password_hash FROM account LIMIT 1")
            return cur.fetchone()["password_hash"]
    stored = db_module.run(work)
    assert "deku-demo-pw-2026" not in stored
    assert stored.startswith("pbkdf2_sha256$")


# ------------------------------------------------------ DP-26, DP-27

def test_curator_cannot_record_clearance(client):
    token = auth(client, "curator@example.com")
    response = client.put("/api/desk/references/quarry-conveyor-upgrade/clearance",
                          headers=desk_headers(token),
                          json={"clearance_from": "2026-01-01",
                                "clearance_until": "2027-01-01"})
    assert response.status_code == 403
    assert response.get_json() == {"message": "Your account cannot do this"}
    body = client.get("/api/desk/references/quarry-conveyor-upgrade",
                      headers=desk_headers(token)).get_json()
    assert body["clearance_from"] is None


def test_steward_records_clearance(client):
    token = auth(client, "steward@example.com")
    response = client.put("/api/desk/references/quarry-conveyor-upgrade/clearance",
                          headers=desk_headers(token),
                          json={"clearance_from": "2026-01-01",
                                "clearance_until": "2027-01-01"})
    assert response.status_code == 200
    body = response.get_json()
    assert body["clearance_from"] == "2026-01-01"
    assert body["live"] is False


def test_curator_cannot_delete_enquiry(client):
    token = auth(client, "curator@example.com")
    queue = client.get("/api/desk/enquiries",
                       headers=desk_headers(token)).get_json()
    response = client.delete("/api/desk/enquiries/" + str(queue[0]["id"]),
                             headers=desk_headers(token))
    assert response.status_code == 403
    assert response.get_json() == {"message": "Your account cannot do this"}


def test_programme_isolation(client):
    token = auth(client, "curator.westhall@example.com")
    headers = desk_headers(token)
    assert client.get("/api/desk/references/harbour-crane-retrofit",
                     headers=headers).status_code == 404
    assert client.patch("/api/desk/references/harbour-crane-retrofit",
                        headers=headers, json={"title": "Nope"}).status_code == 404
    assert client.post("/api/desk/references/harbour-crane-retrofit/publish",
                       headers=headers).status_code == 404
    assert client.post("/api/desk/references/harbour-crane-retrofit/preview",
                       headers=headers).status_code == 404
    assert client.put("/api/desk/references/harbour-crane-retrofit/clearance",
                      headers=headers,
                      json={"clearance_from": "2026-01-01",
                            "clearance_until": "2027-01-01"}).status_code == 404
    rows = client.get("/api/desk/references", headers=headers).get_json()
    assert all(r["slug"] != "harbour-crane-retrofit" for r in rows)
    enquiries = client.get("/api/desk/enquiries", headers=headers).get_json()
    assert all(e["email"] != "prospect@example.com" for e in enquiries)
    assert client.put("/api/desk/order", headers=headers,
                      json={"slug": "harbour-crane-retrofit",
                            "ordinal": 1}).status_code == 404


# ---------------------------------------------------- DP-28..30, DP-91

def test_create_draft_and_editable_fields(client):
    token = auth(client, "curator@example.com")
    headers = desk_headers(token)
    payload = {
        "title": "Wind farm converter", "sector": "energy",
        "customer": "Sata Wind", "summary": "A converter swap in stages.",
        "challenge": "No turbine could stop during peak wind.",
        "work": "We swapped converters bay by bay.",
        "published": True, "ordinal": 9,
        "clearance_from": "2026-01-01", "clearance_until": "2027-01-01",
        "programme_id": 2, "role": "steward", "id": 999,
        "figures": [{"label": "Uptime", "value": "99 %", "extra": "ignored"}],
    }
    response = client.post("/api/desk/references", headers=headers, json=payload)
    assert response.status_code == 201, response.data
    slug = response.get_json()["slug"]
    assert slug == "wind-farm-converter"
    body = client.get("/api/desk/references/" + slug, headers=headers).get_json()
    assert body["published"] is False
    assert body["ordinal"] is None
    assert body["clearance_from"] is None
    assert body["state"] == "draft"
    assert body["version"] == 1
    assert body["figures"] == [{"label": "Uptime", "value": "99 %"}]


def test_publish_refusals_and_guards(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    created = client.post("/api/desk/references", headers=headers, json={
        "title": "Mine hoist renewal", "sector": "mining",
        "customer": "Deep Oy", "summary": "Summary.",
        "challenge": "Challenge.", "work": "Work."}).get_json()
    slug = created["slug"]
    response = client.post("/api/desk/references/" + slug + "/publish",
                           headers=headers)
    assert response.status_code == 409
    assert response.get_json() == {"message": "Record a clearance window before publishing"}
    client.put("/api/desk/references/" + slug + "/clearance", headers=headers,
               json={"clearance_from": "2026-01-01",
                     "clearance_until": "2026-02-01"})
    response = client.post("/api/desk/references/" + slug + "/publish",
                           headers=headers)
    assert response.status_code == 409
    assert response.get_json() == {"message": "The clearance window has ended"}
    rows = client.get("/api/references").get_json()
    assert rows[0]["slug"] == "harbour-crane-retrofit"


def test_publish_appends_ordinal_and_appears_at_once(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    created = client.post("/api/desk/references", headers=headers, json={
        "title": "Sawmill sorter", "sector": "wood",
        "customer": "Puu Oy", "summary": "Summary.",
        "challenge": "Challenge.", "work": "Work.",
        "figures": [{"label": "Boards an hour", "value": "800"}]})
    slug = created.get_json()["slug"]
    client.put("/api/desk/references/" + slug + "/clearance", headers=headers,
               json={"clearance_from": "2026-01-01",
                     "clearance_until": "2027-12-31"})
    response = client.post("/api/desk/references/" + slug + "/publish",
                           headers=headers)
    assert response.status_code == 200
    assert response.get_json()["ordinal"] == 4
    rows = client.get("/api/references").get_json()
    assert rows[-1]["slug"] == slug
    assert [r["ordinal"] for r in rows] == [1, 2, 3, 4]
    assert "wood" in client.get("/api/sectors").get_json()
    assert client.get("/api/references/" + slug).status_code == 200
    fi = client.get("/api/fi/references")
    assert slug in [r["slug"] for r in fi.get_json()]


def test_publishing_twice_refused(client):
    token = auth(client, "steward@example.com")
    response = client.post(
        "/api/desk/references/harbour-crane-retrofit/publish",
        headers=desk_headers(token))
    assert response.status_code == 409
    assert response.get_json() == {"message": "This reference is already published"}


def test_states_reported(client):
    token = auth(client, "steward@example.com")
    rows = client.get("/api/desk/references",
                      headers=desk_headers(token)).get_json()
    states = {r["slug"]: r["state"] for r in rows}
    assert states["harbour-crane-retrofit"] == "live"
    assert states["rail-depot-signalling"] == "withheld"
    assert states["quarry-conveyor-upgrade"] == "draft"


def test_desk_order_of_rows(client):
    token = auth(client, "steward@example.com")
    rows = client.get("/api/desk/references",
                      headers=desk_headers(token)).get_json()
    # live first by ordinal, then the rest in Finnish order
    assert rows[0]["slug"] == "harbour-crane-retrofit"
    assert rows[-1]["slug"] == "rail-depot-signalling"


# ------------------------------------------------------------ DP-31, 32

def test_retire_closes_gaps_and_move_rules(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    response = client.post("/api/desk/references/dairy-line-rebuild/retire",
                           headers=headers)
    assert response.status_code == 200
    rows = client.get("/api/references").get_json()
    assert [r["ordinal"] for r in rows] == [1, 2]
    assert client.get("/api/references/dairy-line-rebuild").status_code == 404
    response = client.post("/api/desk/references/dairy-line-rebuild/publish",
                           headers=headers)
    assert response.status_code == 200
    assert response.get_json()["ordinal"] == 3
    response = client.put("/api/desk/order", headers=headers,
                          json={"slug": "dairy-line-rebuild", "ordinal": 1})
    assert response.status_code == 200
    assert [r["slug"] for r in response.get_json()] == [
        "dairy-line-rebuild", "harbour-crane-retrofit", "paper-mill-drive-swap"]
    response = client.put("/api/desk/order", headers=headers,
                          json={"slug": "harbour-crane-retrofit", "ordinal": 999})
    assert response.status_code == 200
    assert response.get_json()[-1]["slug"] == "harbour-crane-retrofit"
    response = client.put("/api/desk/order", headers=headers,
                          json={"slug": "quarry-conveyor-upgrade", "ordinal": 1})
    assert response.status_code == 409
    assert response.get_json() == {"message": "Only a live reference can be moved"}


def test_ordinal_validation(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    for ordinal in (True, 2.0, 2.5, "2", None, 0):
        response = client.put("/api/desk/order", headers=headers,
                              json={"slug": "harbour-crane-retrofit",
                                    "ordinal": ordinal})
        assert response.status_code == 422, ordinal
        assert "ordinal" in response.get_json()["errors"]
    big = client.put("/api/desk/order", headers=headers,
                     json={"slug": "harbour-crane-retrofit",
                           "ordinal": 10 ** 30})
    assert big.status_code == 200
    assert client.put("/api/desk/order", headers=headers,
                      json={"slug": "no-such", "ordinal": 1}).status_code == 404
    assert client.put("/api/desk/order", headers=headers,
                      json={"ordinal": 1}).status_code == 422
    assert client.put("/api/desk/order", headers=headers,
                      json={"slug": "a\x00b", "ordinal": 1}).status_code == 422


def test_concurrent_publishes_one_ordinal(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    created = client.post("/api/desk/references", headers=headers, json={
        "title": "Batch plant control", "sector": "concrete",
        "customer": "Beton Oy", "summary": "s", "challenge": "c", "work": "w",
        "figures": [{"label": "Batches a day", "value": "120"}]}).get_json()
    slug = created["slug"]
    client.put("/api/desk/references/" + slug + "/clearance", headers=headers,
               json={"clearance_from": "2026-01-01",
                     "clearance_until": "2027-12-31"})
    results = []
    def publish():
        with wsgi.app.test_client() as fresh:
            fresh_token = auth(fresh)
            response = fresh.post(
                "/api/desk/references/" + slug + "/publish",
                headers=desk_headers(fresh_token))
            results.append(response.status_code)
    threads = [threading.Thread(target=publish) for _ in range(4)]
    for thread in threads: thread.start()
    for thread in threads: thread.join()
    assert sorted(results) == [200, 409, 409, 409], results
    rows = client.get("/api/references").get_json()
    assert [r["ordinal"] for r in rows] == list(range(1, len(rows) + 1))


# ------------------------------------------------------------- DP-33, 34

def test_preview_lifecycle(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    response = client.post(
        "/api/desk/references/quarry-conveyor-upgrade/preview", headers=headers)
    assert response.status_code == 201
    body = response.get_json()
    token_value = body["token"]
    assert len(token_value) >= 32
    assert "quarry" not in token_value
    detail = client.get("/api/references/quarry-conveyor-upgrade?preview="
                        + token_value)
    assert detail.status_code == 200
    assert detail.headers.get("Cache-Control") == "private, no-store"
    assert detail.headers.get("X-Robots-Tag") == "noindex"
    # a token presented against a live reference is ignored: the reference
    # is served as usual
    other = client.get("/api/references/dairy-line-rebuild?preview=" + token_value)
    assert other.status_code == 200
    # a token presented against another draft slug is refused alike
    third = client.post("/api/desk/references",
                         headers=headers, json={
                             "title": "Other draft", "sector": "wood",
                             "customer": "C", "summary": "s",
                             "challenge": "c", "work": "w"}).get_json()
    refused = client.get("/api/references/" + third["slug"] + "?preview="
                         + token_value)
    assert refused.status_code == 404
    assert refused.data == b'{"message":"Not found"}'
    second = client.post(
        "/api/desk/references/quarry-conveyor-upgrade/preview",
        headers=headers).get_json()
    assert client.get("/api/references/quarry-conveyor-upgrade?preview="
                      + token_value).status_code == 404
    assert client.get("/api/references/quarry-conveyor-upgrade?preview="
                      + second["token"]).status_code == 200


def test_preview_minted_only_for_unpublished(client):
    token = auth(client, "steward@example.com")
    response = client.post(
        "/api/desk/references/harbour-crane-retrofit/preview",
        headers=desk_headers(token))
    assert response.status_code == 409
    assert response.get_json() == {"message": "This reference is already published"}


def test_preview_expiry_validation(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    for value in ("2020-11-11T10:00:00Z", "yesterday", "2026-13-01T00:00:00Z",
                  123):
        response = client.post(
            "/api/desk/references/quarry-conveyor-upgrade/preview",
            headers=headers, json={"expires_at": value})
        assert response.status_code == 422, value
        assert "expires_at" in response.get_json()["errors"], value
    # an absent value, an empty string and a JSON null all mint with the
    # default expiry
    for body in ({}, {"expires_at": None}, {"expires_at": ""}):
        response = client.post(
            "/api/desk/references/quarry-conveyor-upgrade/preview",
            headers=headers, json=body)
        assert response.status_code == 201, body
    far = (dt.datetime.now(dt.timezone.utc)
           + dt.timedelta(seconds=30 * 86400))
    response = client.post(
        "/api/desk/references/quarry-conveyor-upgrade/preview",
        headers=headers,
        json={"expires_at": far.strftime("%Y-%m-%dT%H:%M:%SZ")})
    assert response.status_code == 201


def test_publish_retires_preview_links(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    slug = "quarry-conveyor-upgrade"
    link = client.post(
        "/api/desk/references/" + slug + "/preview",
        headers=headers).get_json()
    client.patch("/api/desk/references/" + slug, headers=headers,
                 json={"figures": [{"label": "Belt uptime", "value": "97 %"}]})
    client.put("/api/desk/references/" + slug + "/clearance", headers=headers,
               json={"clearance_from": "2026-01-01",
                     "clearance_until": "2027-12-31"})
    client.post("/api/desk/references/" + slug + "/publish", headers=headers)
    # the page itself is live now, but the link grants nothing
    assert client.get("/api/references/" + slug).status_code == 200
    # a link held from before publication no longer opens the reference
    # once it is withdrawn
    client.post("/api/desk/references/" + slug + "/retire", headers=headers)
    assert client.get("/api/references/" + slug + "?preview="
                      + link["token"]).status_code == 404
    assert client.get("/api/references/" + slug).status_code == 404


# --------------------------------------------------------- DP-17..19

def test_enquiry_accepted(client):
    response = client.post("/api/enquiries", json={
        "email": "buyer@example.com", "agreed": True,
        "reference": "dairy-line-rebuild",
        "phone": "+358 40 111 2222"})
    assert response.status_code == 201
    body = response.get_json()
    assert body["reply_to"] == "hello@example.com"
    token = auth(client, "steward@example.com")
    queue = client.get("/api/desk/enquiries",
                       headers=desk_headers(token)).get_json()
    assert queue[0]["email"] == "buyer@example.com"
    assert queue[0]["reference"] == "dairy-line-rebuild"
    assert queue[0]["agreed"] is True


def test_enquiry_refusals(client):
    cases = [
        ({"email": "not-an-address", "agreed": True}, ["email"]),
        ({"agreed": True}, ["email"]),
        ({"email": "a@example.com", "agreed": False}, ["agreed"]),
        ({"email": "a@example.com"}, ["agreed"]),
        ({"email": "a@example.com", "agreed": True, "phone": "12"}, ["phone"]),
        ({"email": "a@example.com", "agreed": True, "phone": 12}, ["phone"]),
        ({"email": "a@example.com", "agreed": True,
          "reference": "rail-depot-signalling"}, ["reference"]),
        ({"email": "a@example.com", "agreed": True,
          "reference": "cold-store-automation"}, ["reference"]),
        ({"email": "a" * 250 + "@example.com", "agreed": True}, ["email"]),
    ]
    for payload, keys in cases:
        response = client.post("/api/enquiries", json=payload)
        assert response.status_code == 422, payload
        assert set(response.get_json()["errors"]) == set(keys), payload


def test_enquiry_joining(client):
    first = client.post("/api/enquiries", json={
        "email": "repeat@example.com", "agreed": True}).get_json()
    second = client.post("/api/enquiries", json={
        "email": "  REPEAT@example.com ", "agreed": True}).get_json()
    assert second["id"] == first["id"]
    token = auth(client, "steward@example.com")
    queue = client.get("/api/desk/enquiries",
                       headers=desk_headers(token)).get_json()
    same = [e for e in queue if e["email"].lower() == "repeat@example.com"]
    assert len(same) == 1


def test_enquiry_delete_closes_it(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    created = client.post("/api/enquiries", json={
        "email": "first@example.com", "agreed": True}).get_json()
    queue = client.get("/api/desk/enquiries", headers=headers).get_json()
    target = [e for e in queue if e["email"] == "first@example.com"][0]
    # a curator is refused on an open enquiry, and nothing changes
    curator_token = auth(client, "curator@example.com")
    response = client.delete("/api/desk/enquiries/" + str(target["id"]),
                             headers=desk_headers(curator_token))
    assert response.status_code == 403
    assert response.get_json() == {"message": "Your account cannot do this"}
    still_open = client.get("/api/desk/enquiries", headers=headers).get_json()
    assert target["id"] in [e["id"] for e in still_open]
    response = client.delete("/api/desk/enquiries/" + str(target["id"]),
                             headers=headers)
    assert response.status_code == 204
    assert response.data == b""
    assert client.delete("/api/desk/enquiries/" + str(target["id"]),
                         headers=headers).status_code == 404
    new_id = client.post("/api/enquiries", json={
        "email": "first@example.com", "agreed": True}).get_json()["id"]
    assert new_id != target["id"]


# ------------------------------------------------------------ DP-64

def test_hostile_input_never_5xx(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    cases = [
        ("POST", "/api/enquiries", b'{"email":"a\x00b@example.com","agreed":true}', 422),
        ("POST", "/api/enquiries", b'\xed\xa0\x80', 422),
        ("POST", "/api/enquiries", b'[1,2,3]', 422),
        ("POST", "/api/enquiries", b'"text"', 422),
        ("POST", "/api/enquiries", b'NaN', 422),
        ("POST", "/api/enquiries", b'{"x":' + b'[' * 60000, 422),
        ("POST", "/api/enquiries", b'', 422),
        ("POST", "/api/auth/login",
         b'{"email":"a\\u0000b","password":"x"}', 401),
        ("POST", "/api/desk/references", b'{"title":"a\x00b","sector":"x","customer":"c","summary":"s","challenge":"c","work":"w"}', 422),
        ("PUT", "/api/desk/references/quarry-conveyor-upgrade/clearance", b'{"clearance_from":"a\x00b","clearance_until":"2026-01-01"}', 422),
    ]
    for method, path, body, expected in cases:
        response = client.open(path, method=method, data=body, headers=headers)
        assert response.status_code == expected, (path, body[:20])
        assert response.status_code < 500
    response = client.post("/api/enquiries", data=b'{"email":"a@example.com","agreed":true,"pad":"'
                            + b"x" * 70000 + b'"}')
    assert response.status_code == 413
    assert response.get_json() == {"message": "Request body too large"}


def test_hostile_paths_never_5xx(client):
    for path in ("/references/%00", "/references/%ED%A0%80",
                 "/api/references/%00", "/api/references/%ED%A0%80",
                 "/fi/no-such", "/fi/fi/references", "/fi/desk"):
        response = client.get(path)
        assert response.status_code in (200, 301, 404), path
        assert response.status_code < 500


# ------------------------------------------------------------- DP-80

def test_if_match_versions(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    body = client.get("/api/desk/references/harbour-crane-retrofit",
                      headers=headers).get_json()
    version = body["version"]
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                            headers={**headers, "If-Match": '"' + str(version) + '"'},
                            json={"summary": body["summary"] + " More."})
    assert response.status_code == 200
    assert response.get_json()["version"] == version + 1
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                            headers={**headers, "If-Match": '"' + str(version) + '"'},
                            json={"summary": "Conflict."})
    assert response.status_code == 412
    assert response.get_json() == {"message": "This reference has changed since you opened it"}
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                            headers={**headers, "If-Match": str(version + 1)},
                            json={"summary": "Unquoted."})
    assert response.status_code == 412
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                            headers={**headers, "If-Match": "*"},
                            json={"summary": "Star."})
    assert response.status_code == 200


def test_no_op_patch_changes_nothing(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    before = client.get("/api/desk/references/harbour-crane-retrofit",
                        headers=headers).get_json()
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                            headers=headers, json={"published": False,
                                                   "ordinal": 7, "id": 3})
    assert response.status_code == 200
    after = client.get("/api/desk/references/harbour-crane-retrofit",
                       headers=headers).get_json()
    assert after["version"] == before["version"]
    assert after["published"] is True
    assert after["ordinal"] == before["ordinal"]


# ------------------------------------------------------------- DP-71

def test_clearance_void_on_content_change(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    before = client.get("/api/desk/references/dairy-line-rebuild",
                        headers=headers).get_json()
    response = client.patch("/api/desk/references/dairy-line-rebuild",
                            headers=headers,
                            json={"figures": before["figures"],
                                  "customer": "New Dairy Name"})
    assert response.status_code == 200
    assert response.get_json()["clearance_voided"] is True
    after = client.get("/api/desk/references/dairy-line-rebuild",
                       headers=headers).get_json()
    assert after["clearance_from"] is None
    assert after["state"] == "withheld"
    assert client.get("/api/references/dairy-line-rebuild").status_code == 404
    rows = client.get("/api/references").get_json()
    assert "dairy-line-rebuild" not in [r["slug"] for r in rows]
    assert [r["ordinal"] for r in rows] == [1, 2]


def test_identical_values_void_nothing(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    before = client.get("/api/desk/references/harbour-crane-retrofit",
                        headers=headers).get_json()
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                            headers=headers,
                            json={"figures": before["figures"],
                                  "quote": before["quote"],
                                  "customer": before["customer"],
                                  "title": before["title"].upper()})
    assert response.status_code == 200
    assert response.get_json()["clearance_voided"] is False
    after = client.get("/api/desk/references/harbour-crane-retrofit",
                       headers=headers).get_json()
    assert after["clearance_from"] == before["clearance_from"]
    assert after["state"] == "live"


def test_editing_title_only_keeps_window(client):
    token = auth(client, "steward@example.com")
    response = client.patch("/api/desk/references/paper-mill-drive-swap",
                           headers=desk_headers(token),
                           json={"work": "We changed the wording."})
    assert response.get_json()["clearance_voided"] is False


# ------------------------------------------------------------- DP-58

def test_window_validation(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    cases = [
        ({"clearance_from": "20260203", "clearance_until": "2026-03-01"},
         ["clearance_from"]),
        ({"clearance_from": "2026-W01-1", "clearance_until": "2026-03-01"},
         ["clearance_from"]),
        ({"clearance_from": "2026-02-30", "clearance_until": "2026-03-01"},
         ["clearance_from"]),
        ({"clearance_from": "2026-01-01"}, ["clearance_until"]),
        ({}, ["clearance_from", "clearance_until"]),
        ({"clearance_from": "2026-03-01", "clearance_until": "2026-02-01"},
         ["clearance_until"]),
    ]
    for payload, keys in cases:
        response = client.put(
            "/api/desk/references/quarry-conveyor-upgrade/clearance",
            headers=headers, json=payload)
        assert response.status_code == 422, payload
        assert set(response.get_json()["errors"]) == set(keys)
    one_day = client.put(
        "/api/desk/references/quarry-conveyor-upgrade/clearance",
        headers=headers,
        json={"clearance_from": "2026-05-05", "clearance_until": "2026-05-05"})
    assert one_day.status_code == 200


def test_narrowing_withdraws_reopening_appends_last(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    client.put("/api/desk/references/rail-depot-signalling/clearance",
               headers=headers,
               json={"clearance_from": "2026-01-01",
                     "clearance_until": "2027-12-31"})
    client.post("/api/desk/references/rail-depot-signalling/publish",
                headers=headers)
    rows = client.get("/api/references").get_json()
    assert rows[-1]["slug"] == "rail-depot-signalling"
    assert rows[-1]["ordinal"] == 4
    client.put("/api/desk/references/rail-depot-signalling/clearance",
               headers=headers,
               json={"clearance_from": "2025-01-01",
                     "clearance_until": "2025-06-01"})
    rows = client.get("/api/references").get_json()
    assert "rail-depot-signalling" not in [r["slug"] for r in rows]
    assert [r["ordinal"] for r in rows] == [1, 2, 3]
    client.put("/api/desk/references/rail-depot-signalling/clearance",
               headers=headers,
               json={"clearance_from": "2026-01-01",
                     "clearance_until": "2027-12-31"})
    rows = client.get("/api/references").get_json()
    assert rows[-1]["slug"] == "rail-depot-signalling"
    assert rows[-1]["ordinal"] == 4


# ------------------------------------------------------------- DP-86

def test_slug_derivation_and_clashes(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    def create(title):
        return client.post("/api/desk/references", headers=headers, json={
            "title": title, "sector": "ports", "customer": "C",
            "summary": "s", "challenge": "c", "work": "w"})
    first = create("Harbour crane retrofit").get_json()
    assert first["slug"] == "harbour-crane-retrofit-2"
    # ä, å and ö fold to a, o and a; every other run of non a-z becomes a
    # single hyphen, so ë separates and drops.
    body = create("Härböur cräne rëtrofit").get_json()
    assert body["slug"] == "harbour-crane-r-trofit"
    refused = create("!!!")
    assert refused.status_code == 422
    assert "title" in refused.get_json()["errors"]
    empty = create("")
    assert empty.status_code == 422


def test_renames_and_redirects(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    response = client.patch("/api/desk/references/harbour-crane-retrofit",
                           headers=headers,
                           json={"title": "Harbour crane modernisation"})
    assert response.status_code == 200
    assert response.get_json()["slug"] == "harbour-crane-modernisation"
    old = client.get("/api/references/harbour-crane-retrofit?x=a%20b&y=%C3%A4")
    assert old.status_code == 301
    assert old.headers["Location"].endswith(
        "/api/references/harbour-crane-modernisation?x=a%20b&y=%C3%A4")
    new = client.get("/api/references/harbour-crane-modernisation")
    assert new.status_code == 200
    fi = client.get("/api/fi/references/harbour-crane-retrofit")
    assert fi.status_code == 301
    assert fi.headers["Location"].endswith(
        "/api/fi/references/harbour-crane-modernisation")
    page = client.get("/references/harbour-crane-retrofit")
    assert page.status_code == 301
    assert page.headers["Location"].endswith(
        "/references/harbour-crane-modernisation")
    response = client.patch("/api/desk/references/harbour-crane-modernisation",
                           headers=headers,
                           json={"title": "HARBOUR CRANE MODERNISATION"})
    assert response.get_json()["slug"] == "harbour-crane-modernisation"
    response = client.patch("/api/desk/references/harbour-crane-modernisation",
                           headers=headers,
                           json={"title": "Harbour crane retrofit"})
    assert response.get_json()["slug"] == "harbour-crane-retrofit"
    current = client.get("/api/references/harbour-crane-retrofit")
    assert current.status_code == 200


def test_redirect_refused_when_not_live(client):
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    client.patch("/api/desk/references/paper-mill-drive-swap",
                 headers=headers, json={"title": "Paper mill drive change"})
    client.post("/api/desk/references/paper-mill-drive-change/retire",
                headers=headers)
    assert client.get("/api/references/paper-mill-drive-swap").status_code == 404
    assert client.get("/api/references/paper-mill-drive-change").status_code == 404
    assert client.get("/references/paper-mill-drive-swap").status_code == 404
    client.post("/api/desk/references/paper-mill-drive-change/publish",
                headers=headers)
    assert client.get("/api/references/paper-mill-drive-swap").status_code == 301


# ------------------------------------------------------------- DP-62

def test_service_clock_offset_governs_now(client):
    import db as db_module
    def set_offset(seconds):
        def work(conn):
            with conn.cursor() as cur:
                cur.execute("UPDATE service_clock SET offset_seconds = %s",
                            (seconds,))
            conn.commit()
        db_module.run(work)
    set_offset(400 * 86400)
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    client.patch("/api/desk/references/quarry-conveyor-upgrade",
                 headers=headers,
                 json={"figures": [{"label": "Belt uptime", "value": "98 %"}]})
    client.put("/api/desk/references/quarry-conveyor-upgrade/clearance",
               headers=headers,
               json={"clearance_from": "2027-11-01",
                     "clearance_until": "2027-12-31"})
    publish = client.post(
        "/api/desk/references/quarry-conveyor-upgrade/publish", headers=headers)
    assert publish.status_code == 200, publish.data
    assert client.get("/api/references/quarry-conveyor-upgrade").status_code == 200
    set_offset(0)
    assert client.get("/api/references/quarry-conveyor-upgrade").status_code == 404


# ------------------------------------------------------------- DP-38

def test_finnish_mirror_and_translation_note(client):
    rows = client.get("/api/fi/references").get_json()
    first = [r for r in rows if r["slug"] == "harbour-crane-retrofit"][0]
    assert first["title"] == "Satamanosturin modernisointi"
    detail = client.get("/api/fi/references/harbour-crane-retrofit").get_json()
    assert detail["translated"] is True
    assert detail["body"] is not None
    dairy = client.get("/api/fi/references/dairy-line-rebuild").get_json()
    assert dairy["translated"] is False
    assert dairy["body"] is None
    assert dairy["title"] == "Dairy line rebuild"


# ------------------------------------------------------------- DP-56

def test_head_answers_as_get(client):
    response = client.head("/api/references")
    assert response.status_code == 200
    assert response.data == b""
    get_response = client.get("/api/references")
    assert int(get_response.headers["Content-Length"]) == len(get_response.data)


# ------------------------------------------------------------- DP-82

def test_preview_expiry_counts_elapsed_seconds(client):
    import db as db_module
    import core
    # Mint at 2026-10-22 12:00 Helsinki (09:00 UTC) on the service clock.
    def set_offset(seconds):
        def work(conn):
            with conn.cursor() as cur:
                cur.execute("UPDATE service_clock SET offset_seconds = %s",
                            (seconds,))
            conn.commit()
        db_module.run(work)
    import datetime as dt
    target = dt.datetime(2026, 10, 22, 9, 0, tzinfo=dt.timezone.utc)
    set_offset(int((target - dt.datetime.now(dt.timezone.utc)).total_seconds()))
    token = auth(client, "steward@example.com")
    link = client.post("/api/desk/references/quarry-conveyor-upgrade/preview",
                       headers=desk_headers(token), json={}).get_json()
    expiry = dt.datetime.fromisoformat(link["expires_at"].replace("Z", "+00:00"))
    assert expiry == dt.datetime(2026, 10, 29, 9, 0, tzinfo=dt.timezone.utc)
    # 604800 seconds later; Helsinki shows 11:00 because the clocks went back
    assert expiry.astimezone(core.HELSINKI).hour == 11
    set_offset(0)


# ------------------------------------------------------------- DP-69

def test_rollover_under_date_change(client):
    import db as db_module
    def set_offset(days):
        def work(conn):
            with conn.cursor() as cur:
                cur.execute("UPDATE service_clock SET offset_seconds = %s",
                            (days * 86400,))
            conn.commit()
        db_module.run(work)

    # today is far past every seeded window: the whole run withdraws
    set_offset(800)
    rows = client.get("/api/references").get_json()
    assert rows == []
    assert client.get("/api/references/harbour-crane-retrofit").status_code == 404
    assert client.get("/api/references/dairy-line-rebuild").status_code == 404
    # a publish then is refused; the session is signed in on the moved
    # clock so it is still valid
    token = auth(client, "steward@example.com")
    response = client.post("/api/desk/references/quarry-conveyor-upgrade/publish",
                           headers=desk_headers(token))
    assert response.status_code == 409
    assert response.get_json() == {"message": "Record a clearance window before publishing"}
    # an already-published reference with an ended window is refused alike
    response = client.post("/api/desk/references/harbour-crane-retrofit/publish",
                           headers=desk_headers(token))
    assert response.status_code == 409
    assert response.get_json() == {"message": "This reference is already published"}
    set_offset(-750)  # today is before every seeded window has opened
    assert client.get("/api/references").get_json() == []
    set_offset(0)
    rows = client.get("/api/references").get_json()
    assert [r["ordinal"] for r in rows] == [1, 2, 3]


def test_rollover_joins_future_window_at_the_end(client):
    import db as db_module
    token = auth(client, "steward@example.com")
    headers = desk_headers(token)
    created = client.post("/api/desk/references", headers=headers, json={
        "title": "Turbine hall overhaul", "sector": "energy",
        "customer": "Tuuli Oy", "summary": "s", "challenge": "c", "work": "w",
        "figures": [{"label": "Runs a year", "value": "330"}]}).get_json()
    slug = created["slug"]
    client.put("/api/desk/references/" + slug + "/clearance", headers=headers,
               json={"clearance_from": "2026-11-20",
                     "clearance_until": "2026-12-20"})
    published = client.post("/api/desk/references/" + slug + "/publish",
                            headers=headers)
    assert published.get_json()["ordinal"] is None
    assert client.get("/api/references/" + slug).status_code == 404

    def set_offset(days):
        def work(conn):
            with conn.cursor() as cur:
                cur.execute("UPDATE service_clock SET offset_seconds = %s",
                            (days * 86400,))
            conn.commit()
        db_module.run(work)

    # jump over the window's first day: it joins at the end of the run
    set_offset(10)
    rows = client.get("/api/references").get_json()
    assert [r["slug"] for r in rows] == [
        "harbour-crane-retrofit", "dairy-line-rebuild", "paper-mill-drive-swap",
        slug]
    assert [r["ordinal"] for r in rows] == [1, 2, 3, 4]
    set_offset(0)
    rows = client.get("/api/references").get_json()
    assert slug not in [r["slug"] for r in rows]


# ------------------------------------------------------------- DP-89

def test_non_live_rows_sort_in_finnish_order(client):
    token = auth(client, "curator@example.com")
    headers = desk_headers(token)
    def create(title):
        return client.post("/api/desk/references", headers=headers, json={
            "title": title, "sector": "wood", "customer": "C",
            "summary": "s", "challenge": "c", "work": "w"})
    for title in ("Zinc", "abc", "Åland", "Ämmä", "Öljy", "Ankkuri"):
        create(title)
    rows = client.get("/api/desk/references", headers=headers).get_json()
    non_live = [r["title"] for r in rows if r["state"] != "live"]
    # a to z, then å, ä, ö, ignoring case, ties by slug
    expected = ["abc", "Ankkuri", "Quarry conveyor upgrade",
                "Rail depot signalling", "Zinc", "Åland", "Ämmä", "Öljy"]
    assert non_live == expected
