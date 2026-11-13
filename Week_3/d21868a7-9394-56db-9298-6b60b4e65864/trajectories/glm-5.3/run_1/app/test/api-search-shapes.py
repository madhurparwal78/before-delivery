import json, urllib.request, http.cookiejar
BASE = "http://127.0.0.1:4173"
def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(opener, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {})
    try:
        r = opener.open(req)
        return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")
fails = []
def check(name, cond, detail=""):
    if cond: print(f"ok   {name}")
    else:
        fails.append(name); print(f"FAIL {name} {detail}")

def signed(email):
    o = client()
    s, _ = call(o, "POST", "/api/session", {"email": email, "password": "channel-season-26"})
    assert s == 200
    return o

# grower reach
o = signed("lin@growers.example")
s, b = call(o, "GET", "/api/search?q=Lateral")
check("grower sees channels", all(x["kind"] in ("channel",) for x in b["suggestions"]), b["suggestions"])
check("grower channel href", all(x["href"].startswith("/grower") for x in b["suggestions"]), [x["href"] for x in b["suggestions"]])
s, b = call(o, "GET", "/api/search?q=T4")
check("grower sees only own turnouts", [x["label"] for x in b["suggestions"]] == ["T4-15"], [x["label"] for x in b["suggestions"]])
s, b = call(o, "GET", "/api/search?q=Mara")
check("grower cannot see growers", all(x["kind"] != "grower" for x in b["suggestions"]), b["suggestions"])
s, b = call(o, "GET", "/api/search?q=OP-C")
check("grower sees operators", all(x["kind"] == "operator" for x in b["suggestions"]), b["suggestions"])
check("grower operator href", all(x["href"] == "/grower/orders/new" for x in b["suggestions"]), [x["href"] for x in b["suggestions"]])

# operator reach
o = signed("jo@contractors.example")
s, b = call(o, "GET", "/api/search?q=Lateral")
check("operator sees channels only", all(x["kind"] == "channel" for x in b["suggestions"]), b["suggestions"])
check("operator channel href /field", all(x["href"] == "/field" for x in b["suggestions"]), [x["href"] for x in b["suggestions"]])
s, b = call(o, "GET", "/api/search?q=T4-07")
check("operator cannot see turnouts", all(x["kind"] != "turnout" for x in b["suggestions"]), b["suggestions"])

# reviewer reach
o = signed("quinn@regulator.example")
s, b = call(o, "GET", "/api/search?q=Lateral")
check("reviewer sees channels", all(x["kind"] == "channel" for x in b["suggestions"]), b["suggestions"])
check("reviewer channel href capacity", all(x["href"].startswith("/channels/") for x in b["suggestions"]), [x["href"] for x in b["suggestions"]])
s, b = call(o, "GET", "/api/search?q=Mara")
check("reviewer cannot see growers", all(x["kind"] != "grower" for x in b["suggestions"]), b["suggestions"])

# dispatcher reach: everything
o = signed("hal@wirrinbah.example")
s, b = call(o, "GET", "/api/search?q=T4")
kinds = sorted(set(x["kind"] for x in b["suggestions"]))
check("dispatcher sees turnouts", "turnout" in kinds, kinds)
s, b = call(o, "GET", "/api/search?q=Mara")
check("dispatcher sees grower", any(x["kind"] == "grower" for x in b["suggestions"]), b["suggestions"])
g = next(x for x in b["suggestions"] if x["kind"] == "grower")
check("grower detail turnouts", g["detail"] == "T4-07, T4-09, T9-02, T12-04", g["detail"])
check("grower href board channels", g["href"].startswith("/board?channels="), g["href"])
s, b = call(o, "GET", "/api/search?q=0491")
check("dispatcher phone search", len(b["suggestions"]) >= 1, b["suggestions"])
s, b = call(o, "GET", "/api/search?q=Jo")
check("dispatcher name search", any("Jo Calder" in x["label"] for x in b["suggestions"]), [x["label"] for x in b["suggestions"]])
s, b = call(o, "GET", "/api/search?q=a")
check("one character refused", s == 422)
s, b = call(o, "GET", "/api/search?q=" + "x" * 61)
check("too long refused", s == 422)

# ordering: by kind then label, max 8
s, b = call(o, "GET", "/api/search?q=er")
check("at most 8", s == 200 and len(b["suggestions"]) <= 8, (s, len(b.get("suggestions", []))))
kinds = [x["kind"] for x in b["suggestions"]]
order = {"channel": 0, "turnout": 1, "grower": 2, "operator": 3}
check("kind order", all(order[kinds[i]] <= order[kinds[i+1]] for i in range(len(kinds)-1)), kinds)

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
