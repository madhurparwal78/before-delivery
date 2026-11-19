"""End-to-end journey tests for the Tailboard API, run against a freshly seeded server."""
import json
import time
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://127.0.0.1:4173"
PASSED = []
FAILED = []


def check(name, condition, detail=""):
    if condition:
        PASSED.append(name)
        print(f"  ok: {name}")
    else:
        FAILED.append((name, detail))
        print(f"FAIL: {name} {detail}")


class Client:
    def __init__(self, username=None, passcode=None):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar))
        if username:
            self.req("POST", "/api/session",
                     {"username": username, "passcode": passcode})

    def req(self, method, path, data=None, headers=None, raw=False):
        body = None
        hdrs = dict(headers or {})
        if data is not None:
            body = data if raw else json.dumps(data).encode()
            if not raw:
                hdrs.setdefault("Content-Type", "application/json")
        request = urllib.request.Request(BASE + path, data=body, method=method, headers=hdrs)
        try:
            response = self.opener.open(request)
            payload = response.read()
            parsed = json.loads(payload) if payload else {}
            return response.status, parsed, dict(response.headers)
        except urllib.error.HTTPError as error:
            payload = error.read()
            parsed = json.loads(payload) if payload else {}
            return error.code, parsed, dict(error.headers)


print("== Journey 1: a new directive reaches the board ==")
avery = Client("avery.lund", "saltmarsh-planner-1")
status, board, _ = avery.req("GET", "/api/board")
check("seed totals", board["totals"] == {"open": 20, "due_soon": 6, "overdue": 5,
                                         "deferred": 1, "complied": 4}, str(board["totals"]))
check("four seeded directives", len(board["directives"]) == 4)

pdf = b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"
status, doc, _ = avery.req("POST", "/api/documents", pdf,
                           headers={"Content-Type": "application/pdf"}, raw=True)
check("document upload 201", status == 201, str(status))
same_status, same_doc, _ = avery.req("POST", "/api/documents", pdf,
                                    headers={"Content-Type": "application/pdf"}, raw=True)
check("same bytes 200 same id", same_status == 200 and same_doc["document_id"] == doc["document_id"])

payload = {
    "authority": "UK CAA", "number": "G-2026-0019",
    "title": "Nose gear steering collar — interim inspection",
    "document_id": doc["document_id"],
    "effective_date": "2026-10-01", "calendar_days": 365, "fh_interval": 500.0,
    "applicability": [{"model": "DHC-8-402", "msn_from": 4380, "msn_to": 4499}],
    "method": "Inspect the steering collar for scoring.",
}
status, result, _ = avery.req("POST", "/api/directives", payload)
check("ingest 201", status == 201, str(status))
new_id = result["directive"]["id"]
check("8 threads created", len(result["splice"]["added"]) == 8, str(result["splice"]))

status, board, _ = avery.req("GET", "/api/board")
column = next(d for d in board["directives"] if d["id"] == new_id)
check("new column counts open 8", column["counts"]["open"] == 8, str(column["counts"]))

status, dup, _ = avery.req("POST", "/api/directives", payload)
check("duplicate ingest 409 directive_exists",
      status == 409 and dup["error"]["code"] == "directive_exists", str(status))

cells = [c for c in board["cells"] if c["directive_id"] == new_id and c["stage"] == "open"]
cell = cells[0]
key = {"Idempotency-Key": "j1-defer-1"}
status, res, headers = avery.req("POST", f"/api/threads/{cell['thread_id']}/deferral",
                                 {"reason": "Awaiting parts"}, headers=key)
check("defer 201", status == 201, str(res))
check("thread deferred", res["thread"]["stage"] == "deferred")
status, board, _ = avery.req("GET", "/api/board")
column = next(d for d in board["directives"] if d["id"] == new_id)
check("deferred count up by one", column["counts"]["deferred"] == 1, str(column["counts"]))

status, replay, replay_headers = avery.req(
    "POST", f"/api/threads/{cell['thread_id']}/deferral", {"reason": "Awaiting parts"}, headers=key)
replayed_header = next((value for name, value in replay_headers.items()
                        if name.lower() == "idempotent-replayed"), None)
check("replayed defer same key returns original",
      status == 201 and replayed_header == "true",
      f"{status} headers={list(replay_headers)}")

print("== Journey 2: a revision lands mid-week ==")
noor = Client("noor.haddad", "saltmarsh-planner-2")
status, directives, _ = avery.req("GET", "/api/directives")
easa = next(d for d in directives["directives"] if d["number"] == "2026-0142")
easa_id = easa["id"]

rev_payload = {
    "title": "Main landing gear side brace lower link — detailed visual inspection",
    "document_id": doc["document_id"],
    "effective_date": "2026-11-16", "calendar_days": 200, "fh_interval": 650.0,
    "applicability": [{"model": "ATR72-212A", "msn_from": 1100, "msn_to": 1250},
                      {"model": "DHC-8-402", "msn_from": 4380, "msn_to": 4400}],
    "method": "Inspect the lower link lugs for cracks using a 10x glass; replace the link if any crack is found.",
    "revision": 2, "prior_credit": True,
}
status, result, _ = noor.req("POST", f"/api/directives/{easa_id}/revisions", rev_payload)
check("revision ingest 201", status == 201, str(status))
splice = result["splice"]
check("splice from R1 to R2", splice["from"] == "R1" and splice["to"] == "R2", str(splice))

status, board, _ = avery.req("GET", "/api/board")
easa_col = next(d for d in board["directives"] if d["id"] == easa_id)
check("column now R2", easa_col["revision"] == 2, str(easa_col["revision"]))
check("prior revisions list R1", easa_col["prior_revisions"] == ["R1"])

status, threads, _ = avery.req("GET", f"/api/threads?directive_id={easa_id}")
by_reg = {t["registration"]: t for t in threads["threads"]}
check("kept FNAA stays certified pinned R1",
      by_reg["G-FNAA"]["stage"] == "certified" and by_reg["G-FNAA"]["pinned_revision"] == "R1",
      by_reg["G-FNAA"]["stage"])
check("kept FNAA limits stay R1",
      by_reg["G-FNAA"]["limits"]["deadline_date"] == "2027-04-27",
      by_reg["G-FNAA"]["limits"]["deadline_date"])
check("kept FNAA wording stays R1",
      by_reg["G-FNAA"]["limits"]["calendar_days"] == 180,
      str(by_reg["G-FNAA"]["limits"]["calendar_days"]))
check("kept FNAB also stays certified", by_reg["G-FNAB"]["stage"] == "certified")
check("inspected FNAC retargeted",
      by_reg["G-FNAC"]["stage"] == "superseded_retargeted", by_reg["G-FNAC"]["stage"])
check("claimed FNAD keeps holder",
      by_reg["G-FNAD"]["stage"] == "superseded_retargeted"
      and by_reg["G-FNAD"]["work_card"]["holder"] is not None,
      by_reg["G-FNAD"]["stage"])
check("11 threads for the lineage, one per tail", len(threads["threads"]) == 11,
      str(len(threads["threads"])))
check("G-FNBA added as a new open thread",
      by_reg["G-FNBA"]["stage"] == "open" and by_reg["G-FNBA"]["revision"] == "R2",
      by_reg["G-FNBA"]["stage"])
history = by_reg["G-FNAA"]["history"]
check("FNAA history has two entries", len(history) == 2, str(len(history)))
check("frozen R1 outcome kept", history[0]["outcome"] == "kept", history[0]["outcome"])
check("live R2 outcome current", history[1]["outcome"] == "current")
fnac_sigs = by_reg["G-FNAC"]["signatures"]
check("FNAC inspection superseded",
      any(s["status"] == "superseded" for s in fnac_sigs), str(fnac_sigs))

fnaf = by_reg["G-FNAF"]
status, res, _ = avery.req("POST", f"/api/threads/{fnaf['id']}/effectivity",
                           {"decision": "confirmed", "reason": "Effectivity reviewed against R2 MSN range"})
check("effectivity confirmed to open", status == 200 and res["thread"]["stage"] == "open",
      str(res.get("thread", {}).get("stage")))

status, res, _ = noor.req("POST", f"/api/directives/{easa_id}/revisions", rev_payload)
check("out-of-order revision 409", status == 409
      and res["error"]["code"] == "revision_out_of_order", str(status))

status, as_of_board, _ = avery.req("GET", f"/api/board?directive_id={easa_id}&as_of=R1")
check("board under R1 readable", status == 200 and as_of_board["as_of"] == "R1", str(status))
check("R1 snapshot has 10 cells", len(as_of_board["cells"]) == 10, str(len(as_of_board["cells"])))

print("== Journey 3: night shift on one card ==")
dara = Client("dara.okafor", "saltmarsh-insp-1")
sol = Client("sol.brennan", "saltmarsh-insp-2")
fnaf_thread = by_reg["G-FNAF"]
status_a, res_a, _ = dara.req("POST", f"/api/threads/{fnaf_thread['id']}/claim", {},
                             headers={"Idempotency-Key": "j3-dara"})
status_b, res_b, _ = sol.req("POST", f"/api/threads/{fnaf_thread['id']}/claim", {},
                             headers={"Idempotency-Key": "j3-sol"})
winners = [s for s in (status_a, status_b) if s == 200]
check("exactly one claim wins", len(winners) == 1, f"{status_a}/{status_b}")
loser = res_b if status_a == 200 else res_a
check("loser gets card_held with holder",
      loser["error"]["code"] == "card_held" and loser["error"]["holder"]["id"],
      str(loser.get("error", {}).get("code")))

holder = dara if status_a == 200 else sol
jpg = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b"\x00" * 64 + bytes([0xFF, 0xD9])
status, evidence, _ = holder.req("POST", f"/api/threads/{fnaf_thread['id']}/evidence", jpg,
                                 headers={"Content-Type": "image/jpeg"}, raw=True)
check("evidence attached 201", status == 201 and evidence["evidence"]["sha256"], str(status))
check("evidence row has no file name", "filename" not in json.dumps(evidence).lower())

status, signed, _ = holder.req(
    "POST", f"/api/threads/{fnaf_thread['id']}/inspection",
    {"revision": "R2", "method_ref": "AMM 32-11-00 task 3",
     "findings": "No cracks found on the lower link lugs.",
     "evidence_ids": [evidence["evidence"]["id"]]},
    headers={"Idempotency-Key": "j3-sign"})
check("inspection signed 201", status == 201, str(status))
check("signature bound to R2", signed["signature"]["revision"] == "R2")
check("certifier assigned", signed["thread"]["certifier"]["assigned"]["id"] is not None,
      str(signed["thread"]["certifier"]))
status, stale, _ = holder.req(
    "POST", f"/api/threads/{fnaf_thread['id']}/inspection",
    {"revision": "R1", "method_ref": "AMM task", "findings": "stale",
     "evidence_ids": [evidence["evidence"]["id"]]},
    headers={"Idempotency-Key": "j3-stale"})
check("stale revision refused 409", status == 409 and stale["error"]["code"] == "revision_changed",
      str(status))

print("== Journey 4: countersignature and succession ==")
robin = Client("robin.achterberg", "saltmarsh-records-1")
ines = Client("ines.varga", "saltmarsh-cert-1")
tomasz = Client("tomasz.wilk", "saltmarsh-cert-2")
status, threads, _ = avery.req("GET", f"/api/threads?directive_id={easa_id}")
fnac = next(t for t in threads["threads"] if t["registration"] == "G-FNAC")
status, res, _ = avery.req("POST", f"/api/threads/{fnac['id']}/effectivity",
                          {"decision": "confirmed", "reason": "Confirmed against R2"})
check("FNAC returns to claimed with holder",
      res["thread"]["stage"] == "claimed" and res["thread"]["work_card"]["holder"],
      res["thread"]["stage"])
holder_name = res["thread"]["work_card"]["holder"]["display_name"]
sol_again = sol if holder_name == "Sol Brennan" else dara
status, fnac_ev, _ = sol_again.req(
    "POST", f"/api/threads/{fnac['id']}/evidence", jpg,
    headers={"Content-Type": "image/jpeg"}, raw=True)
check("FNAC evidence attached", status == 201, str(status))
status, res, _ = sol_again.req(
    "POST", f"/api/threads/{fnac['id']}/inspection",
    {"revision": "R2", "method_ref": "AMM 32-11-00 task 4",
     "findings": "Link replaced.", "evidence_ids": [fnac_ev["evidence"]["id"]]},
    headers={"Idempotency-Key": "j4-fnac-insp"})
check("FNAC inspection signed", status == 201 and res["thread"]["stage"] == "inspected",
      str(res.get("thread", {}).get("stage")))
check("FNAC assigned to Ines",
      res["thread"]["certifier"]["assigned"]["display_name"] == "Ines Varga",
      str(res["thread"]["certifier"]))

status, people, _ = robin.req("GET", "/api/people")
ines_person = next(p for p in people["people"] if p["username"] == "ines.varga")
status, res, _ = robin.req("PUT", f"/api/engineers/{ines_person['id']}/scope",
                           {"models": ["DHC-8-402"]})
check("scope saved", status == 200 and res["engineer"]["scope"] == ["DHC-8-402"], str(status))
check("succession passes FNAC to Tomasz",
      res["succession"][0]["to"]["display_name"] == "Tomasz Wilk", str(res["succession"]))

status, refused, _ = ines.req("POST", f"/api/threads/{fnac['id']}/countersign",
                              {"revision": "R2"}, headers={"Idempotency-Key": "j4-ines"})
check("out-of-scope countersign refused",
      status == 403 and refused["error"]["code"] == "out_of_scope"
      and refused["error"]["model"] == "ATR72-212A", str(refused))

status, done, _ = tomasz.req("POST", f"/api/threads/{fnac['id']}/countersign",
                            {"revision": "R2"}, headers={"Idempotency-Key": "j4-tomasz"})
check("Tomasz countersigns", status == 201 and done["thread"]["stage"] == "certified",
      str(done.get("thread", {}).get("stage")))
check("cell turns Complied", done["thread"]["label"] == "Complied", done["thread"]["label"])

status, notices, _ = robin.req("GET", "/api/notices?status=queued")
subs = [n for n in notices["notices"] if "passed to you" in n["subject"]]
check("succession notice queued", len(subs) >= 1, str(len(subs)))

print("== Journey 5: spreadsheet history comes in ==")
csv_body = (
    "tail,directive,revision,status,inspector,inspector_licence,inspected_on,"
    "certifier,certifier_licence,certified_on,notes\n"
    "g-fnab,EASA 2026-0142,R1,complied,Mika Hollis,LIC-66-90412,2026-10-01,"
    "Tomasz Wilk,LIC-66-30544,2026-10-01,Legacy closure from spreadsheet\n"
    "G-FNXX,EASA 2026-0142,R1,open,,,,,,,Unknown tail row\n"
    "G-FNAA,easa 2026-0142,R1,complied,Dara Okafor,LIC-66-48213,05/10/2026,"
    "Ines Varga,LIC-66-30218,2026-10-05,UK date format\n"
    "G-FNAA,easa 2026-0142,R1,complied,Dara Okafor,LIC-66-48213,2026-10-05,"
    "Ines Varga,LIC-66-30218,2026-10-05,ISO date duplicate\n"
    "G-FNAC,Unknown SB 999,R1,open,,,,,,,No such directive\n"
    "G-FNAG,EASA 2026-0142,R7,open,,,,,,,Revision never reached\n"
    "G-FNAG,EASA 2026-0142,R1,mystery,,,,,,,Bad status\n"
).encode()
status, res, _ = robin.req("POST", "/api/imports", csv_body,
                           headers={"Content-Type": "text/csv",
                                    "Idempotency-Key": "j5-import"}, raw=True)
check("import 201", status == 201, str(status))
check("merged 2", res["merged"] == 2, str(res["merged"]))
check("duplicates 1", res["duplicates"] == 1, str(res["duplicates"]))
reasons = {o["reason"] for o in res["orphans"]}
check("orphans carry reasons",
      reasons == {"unknown_tail", "unknown_directive", "unknown_revision"}, str(reasons))
check("rejected rows carry field",
      all(r["field"] for r in res["rejected"]) and res["rejected"][0]["field"] == "status",
      str(res["rejected"]))
status, again, _ = robin.req("POST", "/api/imports", csv_body,
                             headers={"Content-Type": "text/csv",
                                      "Idempotency-Key": "j5-import-2"}, raw=True)
check("same file replays stored result",
      status == 200 and again["replayed_file"] is True and again["merged"] == 2, str(status))
status, counts_before_replay, _ = avery.req("GET", "/api/board")
status, counts_after, _ = avery.req("GET", "/api/board")
check("re-import changed no counts",
      counts_after["totals"] == counts_before_replay["totals"], str(counts_after["totals"]))

print("== Journey 6: correction, erasure and the pack ==")
status, threads, _ = avery.req("GET", f"/api/threads?directive_id={easa_id}")
fnab = next(t for t in threads["threads"] if t["registration"] == "G-FNAB")
status, reopened, _ = robin.req("POST", f"/api/threads/{fnab['id']}/reopen",
                                {"reason": "Closed against the wrong work"})
check("reopen 200", status == 200, str(status))
check("reopened stage", reopened["thread"]["stage"] == "reopened")
check("prior signatures void with reason",
      all(s["status"] == "void" and s["void_reason"] for s in reopened["thread"]["signatures"]),
      str(reopened["thread"]["signatures"]))
check("work card kept", reopened["thread"]["work_card"]["id"] == fnab["work_card"]["id"])
check("holder is the last voided inspection signer",
      reopened["thread"]["work_card"]["holder"]["display_name"] == "Mika Hollis",
      str(reopened["thread"]["work_card"]["holder"]))
check("pin cleared", reopened["thread"]["pinned_revision"] is None)
check("history entries unchanged count", len(reopened["thread"]["history"]) == 2,
      str(len(reopened["thread"]["history"])))

status, people, _ = robin.req("GET", "/api/people")
mika = next(p for p in people["people"] if p["username"] == "mika.hollis")
status, erased, _ = robin.req("POST", f"/api/people/{mika['id']}/erasure",
                              {"reason": "Contractor erasure request"})
check("erasure 200", status == 200, str(status))
token = erased["person"]["display_name"]
check("token form", token.startswith("SIGNER-") and len(token) == len("SIGNER-XXXXXXXX"),
      token)
status, threads, _ = avery.req("GET", f"/api/threads?directive_id={easa_id}")
fnab = next(t for t in threads["threads"] if t["registration"] == "G-FNAB")
check("reopened thread has no holder after erasure",
      fnab["stage"] == "reopened" and fnab["work_card"]["holder"] is None,
      fnab["stage"])
names = json.dumps(threads)
check("Mika name gone from threads", "Mika Hollis" not in names and "LIC-66-90412" not in names)
check("token present where Mika signed", token in names, token)
status, search, _ = avery.req("GET", f"/api/search?q={token}")
check("token searchable", any(r["label"] == token for r in search["results"]),
      str(search["results"])[:200])
status, search2, _ = avery.req("GET", "/api/search?q=Mika")
check("name not searchable", all(r["label"] != "Mika Hollis" for r in search2["results"]))

status, pack, headers = robin.req("POST", "/api/packs", {"directive_id": easa_id},
                                  headers={"Idempotency-Key": "j6-pack"})
check("pack queued or transmitted", status in (201, 202), str(status))
pack_id = pack["pack"]["id"]
deadline = time.time() + 30
status, got = 0, {}
while time.time() < deadline:
    status, got, _ = robin.req("GET", f"/api/packs/{pack_id}")
    if got.get("pack", {}).get("status") == "transmitted":
        break
    time.sleep(2)
check("pack transmitted by itself", got.get("pack", {}).get("status") == "transmitted",
      str(got.get("pack", {}).get("status")))
check("pack keys set", got["pack"]["pdf_key"] and got["pack"]["csv_key"],
      str(got["pack"]["pdf_key"]))
import urllib.request as _url
request = _url.Request(BASE + f"/api/packs/{pack_id}/csv")
opener = urllib.request.build_opener(
    urllib.request.HTTPCookieProcessor(avery.jar))
try:
    response = opener.open(request)
    csv_bytes = response.read()
    check("pack csv downloadable", response.status == 200
          and b"registration" in csv_bytes, str(response.status))
except urllib.error.HTTPError as error:
    check("pack csv downloadable", False, str(error.code))
request = _url.Request(BASE + f"/api/packs/{pack_id}/pdf")
try:
    response = opener.open(request)
    pdf_bytes = response.read()
    check("pack pdf starts with %PDF-", pdf_bytes[:5] == b"%PDF-", str(pdf_bytes[:8]))
except urllib.error.HTTPError as error:
    check("pack pdf starts with %PDF-", False, str(error.code))

# allow the notice hold and one worker pass to elapse before reading the sink
time.sleep(40)
try:
    request = urllib.request.Request("http://mailpit:8025/api/v1/messages?limit=50")
    response = urllib.request.urlopen(request, timeout=5)
    emails = json.loads(response.read())
except Exception as exc:
    emails = {"messages": [], "error": str(exc)}
pack_emails = [m for m in emails.get("messages", [])
               if "Compliance pack" in (m.get("Subject") or "")]
check("exactly one pack email", len(pack_emails) == 1, str(len(pack_emails)))
succession_emails = [m for m in emails.get("messages", [])
                     if "passed to you" in (m.get("Subject") or "")]
check("succession email to Tomasz", len(succession_emails) >= 1, str(len(succession_emails)))
check("no email names Mika",
      all("Mika Hollis" not in json.dumps(m) for m in emails.get("messages", [])), "")

print("== Journey 7: the auditor's view ==")
casey = Client("casey.moreau", "saltmarsh-audit-1")
status, r1board, _ = casey.req("GET", f"/api/board?directive_id={easa_id}&as_of=R1")
check("auditor reads R1 board", status == 200, str(status))
fnac_r1 = next(c for c in r1board["cells"] if c["registration"] == "G-FNAC")
check("R1 FNAC shows inspected state", fnac_r1["stage"] == "inspected", fnac_r1["stage"])
status, res, _ = casey.req("POST", f"/api/threads/{fnac['id']}/claim", {},
                           headers={"Idempotency-Key": "j7-audit-claim"})
check("auditor claim refused", status == 403 and res["error"]["code"] == "forbidden", str(status))
status, res, _ = casey.req("POST", f"/api/threads/{fnac['id']}/reopen", {"reason": "nope"})
check("auditor reopen refused", status == 403, str(status))
status, res, _ = casey.req("POST", "/api/imports", b"tail\n", raw=True,
                           headers={"Content-Type": "text/csv",
                                    "Idempotency-Key": "j7-audit-import"})
check("auditor import refused", status == 403, str(status))
status, res, _ = casey.req("POST", "/api/imports", b"tail\n", raw=True,
                           headers={"Content-Type": "text/csv"})
check("keyless import answers 400 before role", status == 400, str(status))
status, res, _ = casey.req("POST", f"/api/people/{mika['id']}/erasure", {"reason": "x"})
check("auditor erasure refused", status == 403, str(status))
status, res, _ = casey.req("PUT", f"/api/engineers/{ines_person['id']}/scope", {"models": []})
check("auditor scope refused", status == 403, str(status))
status, res, _ = casey.req("POST", "/api/packs", {"directive_id": easa_id},
                           headers={"Idempotency-Key": "j7-audit-pack"})
check("auditor pack refused", status == 403, str(status))
status, res, _ = casey.req("POST", f"/api/threads/{fnac['id']}/deferral", {"reason": "x"},
                           headers={"Idempotency-Key": "j7-audit-defer"})
check("auditor defer refused", status == 403, str(status))
status, res, _ = casey.req("GET", "/api/audit?directive_id=" + easa_id)
check("auditor reads audit trail", status == 200 and len(res["entries"]) > 0, str(status))
check("audit actor shown as token after erasure",
      all(e["actor"]["display_name"] != "Mika Hollis" for e in res["entries"]), "")

print()
print(f"passed: {len(PASSED)}  failed: {len(FAILED)}")
for name, detail in FAILED:
    print(f"  FAILED: {name} {detail}")
