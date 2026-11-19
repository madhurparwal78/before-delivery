import json
import subprocess
import sys
import urllib.request
import urllib.error
import http.cookiejar

BASE = "http://localhost:4173"
SETUP = json.load(open("/tmp/setup.json"))
P = {p["name"]: p for p in SETUP["projects"]}

failures = []


def check(label, got, want):
    if got != want:
        failures.append(f"{label}: got {got!r} want {want!r}")
        print(f"  FAIL {label}: got {got!r} want {want!r}")
    else:
        print(f"  ok   {label}")


class Client:
    def __init__(self, email, password):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.call("POST", "/api/session", {"email": email, "password": password})

    def call(self, method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(BASE + path, data=data, method=method)
        if data is not None:
            req.add_header("content-type", "application/json")
        try:
            with self.opener.open(req) as r:
                raw = r.read()
                return r.status, json.loads(raw) if raw and r.headers.get("content-type", "").startswith("application/json") else raw
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw


def dates(project):
    return {i["name"]: (i["start"], i["end"]) for i in project["items"]}


def items_by_name(project):
    return {i["name"]: i for i in project["items"]}


asha = Client("asha@slackwater.test", "asha-plans-2027")
devi = Client("devi@slackwater.test", "devi-plans-2027")

spring = P["Spring launch"]
links_project = P["Link examples"]

print("worked example 3: every link type")
le = links_project["items"]
for frm, to, typ, lag in [("a", "b", "FS", 2), ("b", "c", "SS", -1), ("c", "d", "FF", 1),
                          ("d", "e", "FS", 0), ("e", "f", "SF", 0)]:
    status, body = asha.call("POST", f"/api/projects/{links_project['id']}/links",
                             {"from": le[frm], "to": le[to], "type": typ, "lag": lag})
    if status != 201:
        print("   link failed", status, body)
status, project = asha.call("GET", f"/api/projects/{links_project['id']}")
d = dates(project)
check("A Plan route", d["Plan route"], ("2027-03-01", "2027-03-03"))
check("B Book venue", d["Book venue"], ("2027-03-08", "2027-03-09"))
check("C Print maps", d["Print maps"], ("2027-03-05", "2027-03-11"))
check("D Pack kits", d["Pack kits"], ("2027-03-09", "2027-03-12"))
check("E Kick-off", d["Kick-off"], ("2027-03-12", "2027-03-12"))
check("F Send reminders", d["Send reminders"], ("2027-03-11", "2027-03-12"))

print("worked example 2: move Draft brief to Thu 4 Mar")
si = spring["items"]
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
draft = items_by_name(project)["Draft brief"]
status, body = asha.call("PATCH", f"/api/items/{si['draft']}",
                         {"baseVersion": draft["version"], "start": "2027-03-04"})
check("patch status", status, 200)
check("moved count", len(body["moved"]), 4)
check("finish", body["finish"], "2027-03-17")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
d = dates(project)
check("Draft brief", d["Draft brief"], ("2027-03-04", "2027-03-08"))
check("Review brief", d["Review brief"], ("2027-03-09", "2027-03-11"))
check("Write copy", d["Write copy"], ("2027-03-05", "2027-03-08"))
check("Design pages", d["Design pages"], ("2027-03-12", "2027-03-17"))
check("Sign-off", d["Sign-off"], ("2027-03-17", "2027-03-17"))
crit = {i["name"] for i in project["items"] if i["critical"]}
check("critical set", crit, {"Draft brief", "Review brief", "Design pages", "Sign-off"})

print("move back: dependents return to their chosen starts and no earlier")
draft = items_by_name(project)["Draft brief"]
status, body = asha.call("PATCH", f"/api/items/{si['draft']}",
                         {"baseVersion": draft["version"], "start": "2027-03-01"})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
d = dates(project)
check("Draft brief back", d["Draft brief"], ("2027-03-01", "2027-03-03"))
check("Review brief back", d["Review brief"], ("2027-03-04", "2027-03-05"))
check("Design pages back", d["Design pages"], ("2027-03-11", "2027-03-16"))
check("finish back", project["finish"], "2027-03-16")

print("baseline and variance")
status, body = asha.call("POST", f"/api/projects/{spring['id']}/baseline", {"name": "Promised"})
check("baseline status", status, 201)
status, body = asha.call("POST", f"/api/projects/{spring['id']}/baseline", {"name": "Again"})
check("baseline exists", (status, body.get("error"), body.get("name")), (409, "baseline_exists", "Promised"))
draft = items_by_name(project)["Draft brief"]
asha.call("PATCH", f"/api/items/{si['draft']}", {"baseVersion": draft["version"], "start": "2027-03-04"})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
by = items_by_name(project)
check("variance Draft", by["Draft brief"]["baseline"]["variance"], 3)
check("variance Review", by["Review brief"]["baseline"]["variance"], 3)
check("variance Write", by["Write copy"]["baseline"]["variance"], 3)
check("variance Design", by["Design pages"]["baseline"]["variance"], 1)
check("variance Sign-off", by["Sign-off"]["baseline"]["variance"], 1)
check("finish variance", project["baseline"]["finishVariance"], 1)
check("group baseline null", by["Content"]["baseline"], None)

print("shrink Design pages to 2 days gives -2 (from example 1 dates)")
draft = by["Draft brief"]
asha.call("PATCH", f"/api/items/{si['draft']}", {"baseVersion": draft["version"], "start": "2027-03-01"})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
design = items_by_name(project)["Design pages"]
asha.call("PATCH", f"/api/items/{si['design']}", {"baseVersion": design["version"], "duration": 2})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
by = items_by_name(project)
check("Design pages end", by["Design pages"]["end"], "2027-03-12")
check("variance Design shrink", by["Design pages"]["baseline"]["variance"], -2)
asha.call("PATCH", f"/api/items/{si['design']}",
          {"baseVersion": by["Design pages"]["version"], "duration": 4})

print("loop message")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
status, body = asha.call("POST", f"/api/projects/{spring['id']}/links",
                         {"from": si["design"], "to": si["draft"], "type": "FS", "lag": 0})
check("loop status", status, 422)
check("loop message", body.get("message"),
      "That link would make the project wait on itself: Design pages -> Draft brief -> Review brief -> Design pages.")
draft = items_by_name(project)["Draft brief"]
status, body = asha.call("PUT", f"/api/items/{si['draft']}/predecessors",
                         {"baseVersion": draft["version"], "text": "5"})
check("loop via cell", body.get("message"),
      "That link would make the project wait on itself: Design pages -> Draft brief -> Review brief -> Design pages.")

print("link errors")
status, body = asha.call("POST", f"/api/projects/{spring['id']}/links",
                         {"from": si["draft"], "to": si["review"], "type": "SS", "lag": 0})
check("duplicate", (status, body.get("error")), (409, "duplicate_link"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/links",
                         {"from": si["draft"], "to": si["draft"], "type": "FS", "lag": 0})
check("self", (status, body.get("error")), (422, "self_link"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/links",
                         {"from": si["content"], "to": si["design"], "type": "FS", "lag": 0})
check("group", (status, body.get("error")), (422, "group_link"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/links",
                         {"from": si["draft"], "to": si["design"], "type": "FS", "lag": 99})
check("lag", (status, body.get("error"), body.get("field")), (422, "invalid_link", "lag"))

print("predecessors cell messages")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
review = items_by_name(project)["Review brief"]
for text, want in [("x", "Write predecessors like 2FS+1, 3SS-2."),
                   ("99", "There is no row 99."),
                   ("3", "A task cannot wait for itself."),
                   ("1", "Groups cannot be linked."),
                   ("2FS+99", "Lag must be between -30 and 30 working days."),
                   ("2,2", "Row 2 is listed twice.")]:
    status, body = asha.call("PUT", f"/api/items/{si['review']}/predecessors",
                             {"baseVersion": review["version"], "text": text})
    check(f"cell {text!r}", body.get("message"), want)

print("viewer is refused")
status, body = devi.call("PATCH", f"/api/items/{si['draft']}", {"baseVersion": 1, "start": "2027-03-02"})
check("viewer patch", (status, body.get("error")), (403, "read_only"))
status, body = devi.call("GET", f"/api/projects/{spring['id']}")
check("viewer read", status, 200)

print("version conflict")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
draft = items_by_name(project)["Draft brief"]
status, body = asha.call("PATCH", f"/api/items/{si['draft']}",
                         {"baseVersion": draft["version"] - 1, "percent": 40})
check("conflict", (status, body.get("error"), body.get("by")), (409, "version_conflict", "Asha Rao"))

print("group rollup after Draft brief 40%")
asha.call("PATCH", f"/api/items/{si['draft']}", {"baseVersion": draft["version"], "percent": 40})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
check("Content percent", items_by_name(project)["Content"]["percent"], 41)
asha.call("PATCH", f"/api/items/{si['draft']}",
          {"baseVersion": items_by_name(project)["Draft brief"]["version"], "percent": 20})

print("holidays")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
review = items_by_name(project)["Review brief"]
asha.call("PATCH", f"/api/items/{si['review']}",
          {"baseVersion": review["version"], "start": "2027-03-08", "duration": 3})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
d = dates(project)
check("Review stretched", d["Review brief"], ("2027-03-08", "2027-03-11"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/holidays",
                         {"date": "2027-03-15", "name": "Quiet day"})
check("holiday status", status, 201)
check("holiday moved", len(body["moved"]), 2)
check("holiday finish", body["finish"], "2027-03-18")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
d = dates(project)
check("Design after holiday", d["Design pages"], ("2027-03-12", "2027-03-18"))
check("Sign-off after holiday", d["Sign-off"], ("2027-03-18", "2027-03-18"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/holidays",
                         {"date": "2027-03-13", "name": "Saturday"})
check("weekend holiday", (status, body.get("error")), (422, "weekend"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/holidays",
                         {"date": "2027-03-15", "name": "Twice"})
check("duplicate holiday", (status, body.get("error")), (409, "duplicate_holiday"))
asha.call("DELETE", f"/api/projects/{spring['id']}/holidays/2027-03-15")

print("critical when Review brief is dropped on Mon 8 Mar")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
review = items_by_name(project)["Review brief"]
asha.call("PATCH", f"/api/items/{si['review']}",
          {"baseVersion": review["version"], "start": "2027-03-04", "duration": 2})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
review = items_by_name(project)["Review brief"]
asha.call("PATCH", f"/api/items/{si['review']}", {"baseVersion": review["version"], "start": "2027-03-08"})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
by = items_by_name(project)
check("Review critical", by["Review brief"]["critical"], True)
check("Review dates", (by["Review brief"]["start"], by["Review brief"]["end"]), ("2027-03-08", "2027-03-09"))
check("Design chosen next working day", by["Design pages"]["start"], "2027-03-11")
asha.call("PATCH", f"/api/items/{si['review']}",
          {"baseVersion": by["Review brief"]["version"], "start": "2027-03-04"})

print("workload")
status, body = asha.call("GET", f"/api/workspaces/{SETUP['workspace']['id']}/workload?from=2027-03-01")
people = {p["name"]: p for p in body["people"]}
check("people", sorted(people), ["Asha Rao", "Ben Ode", "Cara Lund"])
ashaDays = {d["date"]: d for d in people["Asha Rao"]["days"]}
check("Asha Mon 1 Mar", ashaDays["2027-03-01"]["hours"], 4)
check("Asha Wed 10 Mar (Office move)", ashaDays["2027-03-10"]["hours"], 3)
check("Ben Thu 11 Mar", {d["date"]: d["hours"] for d in people["Ben Ode"]["days"]}["2027-03-11"], 8)
check("Ben Thu 11 not over", {d["date"]: d["over"] for d in people["Ben Ode"]["days"]}["2027-03-11"], False)
status, body = asha.call("GET", f"/api/workspaces/{SETUP['workspace']['id']}/workload?from=2027-03-02")
check("from must be Monday", (status, body.get("field")), (422, "from"))

print("assign Write copy to Asha at 6 hours: two over-allocated days")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
status, body = asha.call("POST", f"/api/items/{si['write']}/assignees",
                         {"userId": SETUP["users"][0]["id"], "hours": 6})
check("assign status", status, 201)
status, body = asha.call("GET", f"/api/workspaces/{SETUP['workspace']['id']}/workload?from=2027-03-01")
people = {p["name"]: p for p in body["people"]}
ashaDays = {d["date"]: d for d in people["Asha Rao"]["days"]}
check("Tue 2 Mar hours", ashaDays["2027-03-02"]["hours"], 10)
check("Tue 2 Mar over", ashaDays["2027-03-02"]["over"], True)
check("Wed 3 Mar over", ashaDays["2027-03-03"]["over"], True)
check("Mon 1 Mar not over", (ashaDays["2027-03-01"]["hours"], ashaDays["2027-03-01"]["over"]), (4, False))
asha.call("DELETE", f"/api/items/{si['write']}/assignees/{SETUP['users'][0]['id']}")

print("exports")
status, body = asha.call("POST", f"/api/projects/{spring['id']}/exports", {"format": "csv"})
check("csv status", status, 201)
check("csv filename", body.get("filename"), "spring-launch-2027-03-04.csv")
req = urllib.request.Request(BASE + body["downloadUrl"])
with asha.opener.open(req) as r:
    csv = r.read().decode()
    check("csv content type", r.headers["content-type"], "text/csv; charset=utf-8")
    check("csv disposition", r.headers["content-disposition"],
          'attachment; filename="spring-launch-2027-03-04.csv"')
lines = csv.split("\r\n")
check("csv header", lines[0],
      "Row,Name,Type,Group,Start,End,Duration,Percent complete,Critical,Assignees,Predecessors,"
      "Baseline start,Baseline end,Variance")
print("   ", lines[1])
print("   ", lines[2])
print("   ", lines[3])
status, body = asha.call("POST", f"/api/projects/{spring['id']}/exports", {"format": "pdf"})
check("pdf status", status, 201)
req = urllib.request.Request(BASE + body["downloadUrl"])
with asha.opener.open(req) as r:
    pdf = r.read()
    check("pdf content type", r.headers["content-type"], "application/pdf")
check("pdf magic", pdf[:5], b"%PDF-")
status, body = devi.call("POST", f"/api/projects/{spring['id']}/exports", {"format": "csv"})
check("viewer export", status, 201)

print("error precedence")
status, body = asha.call("POST", "/api/projects", {"name": "x" * 90, "workspace": SETUP["workspace"]["id"]})
check("project name", (status, body.get("field")), (422, "name"))
req = urllib.request.Request(BASE + "/api/projects", data=b"x" * 100001, method="POST")
req.add_header("content-type", "application/json")
try:
    asha.opener.open(req)
    check("too large", "no error", 413)
except urllib.error.HTTPError as e:
    check("too large", e.code, 413)
req = urllib.request.Request(BASE + "/api/projects", data=b"notjson", method="POST")
req.add_header("content-type", "text/plain")
try:
    asha.opener.open(req)
    check("unsupported", "no error", 415)
except urllib.error.HTTPError as e:
    check("unsupported", e.code, 415)
req = urllib.request.Request(BASE + "/api/projects", data=b"{}", method="POST")
req.add_header("content-type", "application/json")
req.add_header("origin", "http://evil.test")
try:
    asha.opener.open(req)
    check("bad origin", "no error", 403)
except urllib.error.HTTPError as e:
    check("bad origin", (e.code, json.loads(e.read())["error"]), (403, "bad_origin"))
req = urllib.request.Request(BASE + "/api/me")
try:
    urllib.request.urlopen(req)
    check("unauthenticated", "no error", 401)
except urllib.error.HTTPError as e:
    check("unauthenticated", (e.code, json.loads(e.read())["error"]), (401, "unauthenticated"))
status, body = asha.call("GET", "/api/nope")
check("unknown path", (status, body.get("error")), (404, "not_found"))
req = urllib.request.Request(BASE + "/api/grading/setup", data=b"{}", method="POST")
req.add_header("content-type", "application/json")
try:
    urllib.request.urlopen(req)
    check("setup without key", "no error", 404)
except urllib.error.HTTPError as e:
    check("setup without key", e.code, 404)

print("reorder")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
status, body = asha.call("POST", f"/api/items/{si['write']}/reorder", {"direction": "up"})
check("reorder changed", body["changed"], True)
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
check("rows after reorder", [i["name"] for i in project["items"]],
      ["Content", "Draft brief", "Write copy", "Review brief", "Design pages", "Sign-off"])
asha.call("POST", f"/api/items/{si['write']}/reorder", {"direction": "down"})
status, body = asha.call("POST", f"/api/items/{si['draft']}/reorder", {"direction": "up"})
check("reorder at edge", body["changed"], False)
status, body = asha.call("POST", f"/api/items/{si['content']}/reorder", {"direction": "down"})
check("group not reorderable", (status, body.get("error")), (422, "not_reorderable"))
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
design = items_by_name(project)["Design pages"]
asha.call("PATCH", f"/api/items/{si['design']}",
          {"baseVersion": design["version"], "group": si["content"]})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
check("grouped order", [i["name"] for i in project["items"]],
      ["Content", "Draft brief", "Review brief", "Write copy", "Design pages", "Sign-off"])
design = items_by_name(project)["Design pages"]
asha.call("PATCH", f"/api/items/{si['design']}", {"baseVersion": design["version"], "group": None})
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
check("ungrouped order", [i["name"] for i in project["items"]],
      ["Content", "Draft brief", "Review brief", "Write copy", "Design pages", "Sign-off"])

print("published key sets")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
check("project keys", sorted(project), ["baseline", "finish", "holidays", "id", "items", "links", "name"])
check("item keys", sorted(project["items"][1]),
      ["assignees", "baseline", "chosenStart", "critical", "duration", "end", "float", "group", "id",
       "kind", "late", "name", "percent", "row", "start", "version"])
check("link keys", sorted(project["links"][0]), ["critical", "from", "id", "lag", "to", "type"])
check("group chosenStart", project["items"][0]["chosenStart"], None)
check("group float", project["items"][0]["float"], None)

print("constraint sentence source: a move earlier than the bound")
review = items_by_name(project)["Review brief"]
status, body = asha.call("PATCH", f"/api/items/{si['review']}",
                         {"baseVersion": review["version"], "start": "2027-03-01"})
check("chosen start saved", body["item"]["chosenStart"], "2027-03-01")
check("shown start held", body["item"]["start"], "2027-03-04")
check("constraint predecessor", body["constraint"]["predecessor"], "Draft brief")
asha.call("PATCH", f"/api/items/{si['review']}",
          {"baseVersion": body["item"]["version"], "start": "2027-03-04"})

print("csv neutralises formula cells")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
status, body = asha.call("POST", f"/api/projects/{spring['id']}/items",
                         {"name": "=Total", "kind": "task"})
check("formula name created", status, 201)
status, body = asha.call("POST", f"/api/projects/{spring['id']}/exports", {"format": "csv"})
with asha.opener.open(urllib.request.Request(BASE + body["downloadUrl"])) as r:
    csv = r.read().decode()
check("neutralised", any(line.split(",")[1] == "'=Total" for line in csv.split("\r\n")), True)
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
asha.call("DELETE", f"/api/items/{items_by_name(project)['=Total']['id']}")

print("assignment errors")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
status, body = asha.call("POST", f"/api/items/{si['design']}/assignees",
                         {"userId": SETUP["users"][1]["id"], "hours": 8})
check("already assigned", (status, body.get("error")), (409, "already_assigned"))
status, body = asha.call("POST", f"/api/items/{si['design']}/assignees",
                         {"userId": SETUP["users"][0]["id"], "hours": 0.3})
check("bad hours", (status, body.get("field")), (422, "hours"))
status, body = asha.call("POST", f"/api/items/{si['design']}/assignees",
                         {"userId": SETUP["users"][3]["id"], "hours": 4})
check("viewer cannot be assigned", (status, body.get("field")), (422, "userId"))
status, body = asha.call("POST", f"/api/items/{si['signoff']}/assignees",
                         {"userId": SETUP["users"][0]["id"], "hours": 4})
check("milestone not a task", (status, body.get("error")), (422, "not_a_task"))
status, body = asha.call("DELETE", f"/api/items/{si['design']}/assignees/{SETUP['users'][0]['id']}")
check("not assigned is 404", (status, body.get("error")), (404, "not_found"))

print("item create and edit limits")
status, body = asha.call("POST", f"/api/projects/{spring['id']}/items",
                         {"name": "x", "kind": "task", "duration": 0})
check("task duration 0 refused", (status, body.get("field")), (422, "duration"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/items",
                         {"name": "x", "kind": "milestone", "duration": 2})
check("milestone duration refused", (status, body.get("field")), (422, "duration"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/items",
                         {"name": "x", "kind": "group", "group": si["content"]})
check("group cannot be grouped", (status, body.get("field")), (422, "group"))
status, body = asha.call("POST", f"/api/projects/{spring['id']}/items",
                         {"name": "Weekend task", "kind": "task", "start": "2027-03-06"})
check("weekend start moves on", body["item"]["start"], "2027-03-08")
asha.call("DELETE", f"/api/items/{body['item']['id']}")
status, project = asha.call("GET", f"/api/projects/{spring['id']}")
content = items_by_name(project)["Content"]
status, body = asha.call("PATCH", f"/api/items/{si['content']}",
                         {"baseVersion": content["version"], "percent": 50})
check("group percent refused", (status, body.get("field")), (422, "percent"))
status, body = asha.call("PATCH", f"/api/items/{si['content']}",
                         {"baseVersion": content["version"], "name": "Content plan"})
check("group name allowed", body["item"]["name"], "Content plan")
asha.call("PATCH", f"/api/items/{si['content']}",
          {"baseVersion": body["item"]["version"], "name": "Content"})

print("pdf pages 20 rows at a time")
status, body = asha.call("POST", "/api/projects", {"name": "Long plan", "workspace": SETUP["workspace"]["id"]})
long_id = body["project"]["id"]
for n in range(25):
    asha.call("POST", f"/api/projects/{long_id}/items", {"name": f"Step {n + 1}", "kind": "task"})
status, body = asha.call("POST", f"/api/projects/{long_id}/exports", {"format": "pdf"})
check("long filename", body["filename"], "long-plan-2027-03-04.pdf")
with asha.opener.open(urllib.request.Request(BASE + body["downloadUrl"])) as r:
    pdf = r.read()
check("two pages", pdf.count(b"/Type /Page "), 2)
check("page numbers", (b"(Page 1 of 2) Tj" in pdf, b"(Page 2 of 2) Tj" in pdf), (True, True))
check("row line", b"(1 Step 1 2027-03-04 2027-03-04 1 0%) Tj" in pdf, True)

print()
if failures:
    print(f"{len(failures)} FAILURES")
    for failure in failures:
        print(" -", failure)
    sys.exit(1)
print("all checks passed")
