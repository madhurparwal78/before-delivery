#!/usr/bin/env python3
"""Comprehensive API verification for Pilotlight."""
import json
import sys
import datetime
import io
import urllib.request
import urllib.error
import http.cookiejar
import random
import string
import concurrent.futures

BASE = "http://localhost:4173/api"

results = {"pass": 0, "fail": 0}


def check(name, condition, detail=""):
    if condition:
        results["pass"] += 1
        print(f"  PASS  {name}")
    else:
        results["fail"] += 1
        print(f"  FAIL  {name}  {detail}")


class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def req(self, method, path, body=None, headers=None, raw=False, origin=None, content_type="application/json"):
        url = BASE + path
        data = None
        if body is not None:
            data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body).encode()
        h = {"Content-Type": content_type}
        if headers:
            h.update(headers)
        if origin:
            h["Origin"] = origin
        req = urllib.request.Request(url, data=data, method=method, headers=h)
        try:
            resp = self.opener.open(req, timeout=30)
            payload = resp.read()
            return resp.status, (payload if raw else (json.loads(payload) if payload else {})), dict(resp.headers)
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                parsed = json.loads(payload)
            except Exception:
                parsed = payload
            return e.code, parsed, dict(e.headers)


def rand_key(n=16):
    return "".join(random.choice(string.ascii_lowercase) for _ in range(n))


def fresh_date(days_ahead, base_today):
    return (datetime.date.fromisoformat(base_today) + datetime.timedelta(days=days_ahead)).isoformat()


def cells_for(stations, start_h, start_m, end_h, end_m):
    out = []
    m = start_h * 60 + start_m
    end = end_h * 60 + end_m
    while m < end:
        for st in stations:
            out.append({"station_id": st, "start": "%02d:%02d" % (m // 60, m % 60)})
        m += 15
    return out


def main():
    ember = Client()
    code, body, _ = ember.req("POST", "/session", {"email": "ember@pilotlight.test", "password": "nightshift-demo-26"})
    check("sign in ember", code == 200 and body["user"]["role"] == "member", body)

    code, body, _ = ember.req("GET", "/kitchens/kit-nsc")
    today = body["kitchen"]["today"]
    print(f"\n== today: {today}")

    operator = Client()
    operator.req("POST", "/session", {"email": "operator@nightshift.test", "password": "nightshift-demo-26"})
    ines = Client()
    ines.req("POST", "/session", {"email": "books@ledgerline.test", "password": "nightshift-demo-26"})
    tidewater = Client()
    tidewater.req("POST", "/session", {"email": "tidewater@pilotlight.test", "password": "nightshift-demo-26"})
    wren = Client()
    wren.req("POST", "/session", {"email": "wren@pilotlight.test", "password": "nightshift-demo-26"})
    saltline = Client()
    saltline.req("POST", "/session", {"email": "saltline@pilotlight.test", "password": "nightshift-demo-26"})

    print("\n== transport checks")
    code, body, _ = ember.req("POST", "/quotes", {"date": today}, origin="http://evil.example")
    check("cross-origin 403", code == 403 and body.get("error") == "cross_origin", (code, body))
    code, body, _ = ember.req("POST", "/quotes", b'{"date":', content_type="application/json")
    check("invalid json 400", code == 400 and body.get("error") == "invalid_json", (code, body))
    code, body, _ = ember.req("POST", "/quotes", b'{"date": "x"}', content_type="text/plain")
    check("wrong content type 415", code == 415 and body.get("error") == "unsupported_media_type", (code, body))
    code, body, _ = ember.req("POST", "/quotes", b'{"pad": "' + b"a" * 64001 + b'"}')
    check("payload too large 413", code == 413 and body.get("error") == "payload_too_large", (code, body))

    anon = Client()
    print("\n== auth checks")
    code, body, _ = anon.req("GET", "/bookings")
    check("unauthenticated 401", code == 401 and body.get("error") == "unauthenticated", (code, body))
    code, body, _ = anon.req("GET", "/health")
    check("health public", code == 200 and body.get("status") == "ok", (code, body))
    code, body, _ = anon.req("GET", "/status")
    check("status public", code == 200 and "services" in body, (code, body))
    code, body, _ = ember.req("POST", "/session", {"email": "ember@pilotlight.test", "password": "wrong"})
    check("bad credentials 401", code == 401 and body.get("error") == "invalid_credentials", (code, body))
    code, body, _ = ember.req("POST", "/session", {"password": "x"})
    check("missing email 422", code == 422 and body.get("error") == "validation" and "email" in body.get("errors", {}), (code, body))

    print("\n== visibility and roles")
    code, body, _ = ember.req("GET", "/kitchens/kit-lark")
    check("ember other kitchen 404", code == 404 and body.get("error") == "not_found", (code, body))
    code, body, _ = ember.req("GET", "/kitchens/kit-nsc/loom?member_id=mem-saltline&date=" + today)
    check("member other member loom 404", code == 404, (code, body))
    code, body, _ = ines.req("GET", "/kitchens/kit-nsc/loom?date=" + today)
    check("bookkeeper loom 403", code == 403 and body.get("error") == "forbidden", (code, body))
    code, body, _ = ines.req("GET", "/kitchens/kit-nsc/rate-cards")
    check("bookkeeper rate cards ok", code == 200, (code, body))
    code, body, _ = ines.req("POST", "/kitchens/kit-nsc/rate-cards", {"effective_from": today})
    check("bookkeeper write 403", code == 403, (code, body))
    code, body, _ = ember.req("GET", "/documents")
    check("ember documents ok", code == 200, (code, body))
    code, body, _ = ines.req("GET", "/documents")
    check("bookkeeper documents 403", code == 403, (code, body))

    print("\n== compliance (DP-49/50)")
    d = fresh_date(5, today)
    code, body, _ = tidewater.req("POST", "/quotes", {"date": d, "cells": cells_for(["st-prep-b"], 4, 0, 5, 0)})
    check(
        "tidewater quote marks papers",
        code == 200 and len(body.get("papers", [])) == 4 and body["quote"]["quarters"] == 0,
        (code, body),
    )
    code, body, _ = tidewater.req("POST", "/holds", {"date": d, "cells": cells_for(["st-prep-b"], 4, 0, 5, 0)})
    check("tidewater hold compliance_blocked", code == 422 and body.get("error") == "compliance_blocked", (code, body))
    code, body, _ = tidewater.req("GET", f"/kitchens/kit-nsc/loom?date={d}")
    check("tidewater loom papers flag", body.get("papers") is False and body.get("covered_until") is None, body.get("covered_until"))
    code, body, _ = wren.req("GET", f"/kitchens/kit-nsc/loom?date={d}")
    check("wren covered until today+10", body.get("covered_until") == fresh_date(10, today), body.get("covered_until"))

    print("\n== quote price (seed example) on a fresh date")
    d = fresh_date(20, today)
    seed_cells = cells_for(["st-deck-1", "st-deck-2", "st-mixer", "st-chiller"], 4, 0, 6, 15)
    code, body, _ = ember.req("POST", "/quotes", {"date": d, "cells": seed_cells})
    q = body["quote"]
    check("seed example total", q["total_cents"] == 33332 and q["total"] == "$333.32", (q.get("total"),))
    check("seed example tier steps", q["tier_steps_crossed"] == [2], q.get("tier_steps_crossed"))
    check(
        "seed example lines",
        [(l["station"], l["tier"], l["quarters"], l["amount_cents"]) for l in q["lines"]]
        == [
            ("Deck oven 1", 1, 8, 7600),
            ("Deck oven 1", 2, 1, 888),
            ("Deck oven 2", 1, 8, 7600),
            ("Deck oven 2", 2, 1, 888),
            ("60-quart mixer", 1, 8, 7150),
            ("60-quart mixer", 2, 1, 831),
            ("Blast chiller", 1, 8, 7500),
            ("Blast chiller", 2, 1, 875),
        ],
        [(l["station"], l["tier"], l["quarters"], l["amount_cents"]) for l in q["lines"]],
    )

    print("\n== saltline MTD counts seeded booking")
    d = fresh_date(15, today)
    code, body, _ = saltline.req("POST", "/quotes", {"date": d, "cells": cells_for(["st-range"], 4, 0, 6, 0)})
    q = body["quote"]
    check("saltline month hours before", q["month_hours_before"] == "4.00", q.get("month_hours_before"))

    print("\n== hold + confirm + release")
    d = fresh_date(21, today)
    key = "confirm-" + rand_key()
    code, body, _ = ember.req("POST", "/holds", {"date": d, "cells": cells_for(["st-kettle"], 5, 0, 6, 0)})
    check("hold placed 201", code == 201 and body["hold"]["state"] == "held", (code, body))
    hold_id = body["hold"]["id"]
    hold_quote_cents = body["hold"]["quote"]["total_cents"]
    check("hold has expiry", body["hold"]["expires_at"] > body["hold"]["server_now"], body["hold"])
    code, body, _ = ember.req(
        "POST", f"/holds/{hold_id}/confirm", {"use_pack": False, "quoted_total_cents": hold_quote_cents - 1}, headers={"Idempotency-Key": key}
    )
    check("confirm mismatch 409 quote_changed", code == 409 and body.get("error") == "quote_changed" and "quote" in body, (code, body))
    code, body, _ = ember.req("GET", f"/holds/{hold_id}")
    check("hold still live after quote_changed", body["hold"]["state"] == "held", body.get("hold", {}).get("state"))
    code, body, _ = ember.req("DELETE", f"/holds/{hold_id}")
    check("hold released", code == 200 and body["hold"]["state"] == "released", (code, body))
    code, body, _ = ember.req("DELETE", f"/holds/{hold_id}")
    check("release again 409 hold_not_active", code == 409 and body.get("error") == "hold_not_active", (code, body))

    print("\n== confirm happy path with idempotency")
    d = fresh_date(26, today)
    cells = cells_for(["st-convection"], 4, 0, 5, 30)
    code, body, _ = ember.req("POST", "/holds", {"date": d, "cells": cells})
    hold_id = body["hold"]["id"]
    total = body["hold"]["quote"]["total_cents"]
    key = "conf-" + rand_key()
    code, body, _ = ember.req("POST", f"/holds/{hold_id}/confirm", {"use_pack": False, "quoted_total_cents": total}, headers={"Idempotency-Key": key})
    check("confirm 201", code == 201 and body["booking"]["state"] == "confirmed", (code, body.get("error")))
    booking = body["booking"]
    invoice = body["invoice"]
    check("billing amount equals total", invoice["billing_amount_cents"] == invoice["total_cents"] == total, invoice)
    code, replay, _ = ember.req("POST", f"/holds/{hold_id}/confirm", {"use_pack": False, "quoted_total_cents": total}, headers={"Idempotency-Key": key})
    check("replay same booking", code == 201 and replay["booking"]["ref"] == booking["ref"] and replay["invoice"]["ref"] == invoice["ref"], (code, replay.get("booking", {}).get("ref")))
    code, body, _ = ember.req("POST", f"/holds/{hold_id}/confirm", {"use_pack": True, "quoted_total_cents": 0}, headers={"Idempotency-Key": key})
    check("reuse key different body 409", code == 409 and body.get("error") == "idempotency_key_reused", (code, body))

    print("\n== hold race: two members same cells (DP-20)")
    d = fresh_date(6, today)
    race_cells = cells_for(["st-chiller"], 5, 0, 7, 0)

    def place(client):
        return client.req("POST", "/holds", {"date": d, "cells": race_cells})

    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        f1 = ex.submit(place, ember)
        f2 = ex.submit(place, saltline)
    r1 = f1.result()
    r2 = f2.result()
    winners = [r for r in (r1, r2) if r[0] == 201]
    losers = [r for r in (r1, r2) if r[0] == 409]
    check("exactly one winner", len(winners) == 1 and len(losers) == 1, (r1[0], r2[0]))
    check(
        "loser told cells_taken",
        bool(losers) and losers[0][1].get("error") == "cells_taken" and len(losers[0][1].get("taken", [])) == 8,
        losers[0][1] if losers else None,
    )

    print("\n== pack hours journey (DP-31..34)")
    key = "pack-" + rand_key()
    code, body, _ = ember.req("POST", "/members/mem-ember/packs", {}, headers={"Idempotency-Key": key})
    check("buy pack 201", code == 201 and body["movement"]["kind"] == "purchase" and body["movement"]["quarters"] == 80, (code, body))
    pack_invoice = body["invoice"]
    check("pack invoice billing matches", pack_invoice["killbill_invoice_id"] is not None and pack_invoice["billing_amount_cents"] == pack_invoice["total_cents"] == 56000, pack_invoice)
    code, body, _ = ember.req("POST", "/members/mem-ember/packs", {}, headers={"Idempotency-Key": key})
    check("pack replay no double charge", code == 201 and body["invoice"]["ref"] == pack_invoice["ref"], (code, body.get("invoice", {}).get("ref")))
    code, body, _ = ember.req("GET", "/members/mem-ember/pack")
    balance_before = body["balance_quarters"]
    d = fresh_date(23, today)
    pack_cells = cells_for(["st-prep-a", "st-prep-b"], 4, 30, 6, 30)
    code, pq, _ = ember.req("POST", "/quotes", {"date": d, "cells": pack_cells, "use_pack": True})
    q = pq["quote"]
    check("pack quote prices pack cells zero", q["pack_quarters"] == min(balance_before, len(pack_cells)), (q.get("pack_quarters"),))
    pack_total = q["total_cents"]
    pack_drawn = q["pack_quarters"]
    code, body, _ = ember.req("POST", "/holds", {"date": d, "cells": pack_cells})
    hold_id = body["hold"]["id"]
    code, body, _ = ember.req("POST", f"/holds/{hold_id}/confirm", {"use_pack": True, "quoted_total_cents": pack_total}, headers={"Idempotency-Key": "pb-" + rand_key()})
    check("pack booking confirmed", code == 201 and body["booking"]["pack_quarters"] == pack_drawn, (code, body.get("error")))
    pack_booking = body["booking"]
    check("pack booking zero total no billing", pack_total == 0 and body["invoice"]["killbill_invoice_id"] is None, (pack_total, body["invoice"]))
    code, body, _ = ember.req("GET", "/members/mem-ember/pack")
    check("balance dropped by draw", body["balance_quarters"] == balance_before - pack_drawn, (balance_before, pack_drawn, body["balance_quarters"]))

    print("\n== cancel in window (DP-35/36)")
    code, body, _ = ember.req("POST", f"/bookings/{pack_booking['id']}/cancel", {})
    check("cancel in window", code == 200 and body["booking"]["state"] == "cancelled_in_window", (code, body.get("booking", {}).get("state")))
    check(
        "cancel refund pack",
        body["refund"]["pack_quarters"] == pack_drawn and body["refund"]["amount_cents"] == pack_booking["total_cents"],
        (body.get("refund"), pack_drawn, pack_booking["total_cents"]),
    )
    code, body, _ = ember.req("GET", "/members/mem-ember/pack")
    check("balance restored", body["balance_quarters"] == balance_before, (balance_before, body["balance_quarters"]))
    draw_refunds = [m for m in body["movements"] if m["kind"] == "refund"]
    check("refund movement reverses draw", bool(draw_refunds) and all(m["reverses"] for m in draw_refunds), draw_refunds)

    print("\n== day sheet (DP-52)")
    code, body, _ = operator.req("POST", f"/bookings/{booking['id']}/check-in", {})
    check("check-in before booking day 409", code == 409 and body.get("error") == "booking_day_not_reached", (code, body))
    code, body, _ = ember.req("POST", f"/bookings/{booking['id']}/check-in", {})
    check("member cannot check in 403", code == 403, (code, body))
    code, body, _ = ember.req("POST", f"/bookings/{booking['id']}/cancel", {})
    check("cancel seeded booking in window", code == 200 and body["booking"]["state"] == "cancelled_in_window", (code, body))
    code, body, _ = ember.req("POST", f"/bookings/{booking['id']}/cancel", {})
    check("cancel twice invalid_transition", code == 409 and body.get("error") == "invalid_transition" and body.get("to") == "cancelled", (code, body))

    print("\n== documents (DP-44..48)")
    pdf = b"%PDF-1.4 test document"
    boundary = "----pilotlight" + rand_key()

    def multipart(fields, filename, content):
        buf = io.BytesIO()
        for name, value in fields:
            buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
        buf.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n\r\n".encode())
        buf.write(content)
        buf.write(f"\r\n--{boundary}--\r\n".encode())
        return buf.getvalue()

    exp = (datetime.date.fromisoformat(today) + datetime.timedelta(days=120)).isoformat()
    code, body, _ = ember.req(
        "POST", "/documents", multipart([("type", "insurance"), ("expires_on", exp)], "cert.pdf", pdf),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    check("upload pdf 201", code == 201 and body["document"]["state"] == "uploaded" and body["document"]["content_type"] == "application/pdf", (code, body))
    doc_id = body["document"]["id"]
    code, body, _ = ember.req(
        "POST", "/documents", multipart([("type", "insurance"), ("expires_on", exp)], "x.html", b"<html>"),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    check("html upload 415 unsupported_type", code == 415 and body.get("error") == "unsupported_type", (code, body))
    code, body, _ = ember.req(
        "POST", "/documents", multipart([("type", "insurance"), ("expires_on", exp)], "empty.pdf", b""),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    check("empty file 422", code == 422 and body.get("error") == "validation", (code, body))
    code, body, _ = ember.req(
        "POST", "/documents", multipart([("type", "insurance"), ("expires_on", "2020-01-01")], "past.pdf", pdf),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    check("past expiry 422", code == 422 and body.get("error") == "validation", (code, body))
    code, body, _ = ember.req(
        "POST", "/documents", multipart([("type", "insurance")], "noexp.pdf", pdf),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    check("missing expiry 422", code == 422, (code, body))
    code, body, _ = operator.req("POST", f"/documents/{doc_id}/verify", {})
    check("verify 200", code == 200 and body["document"]["state"] == "verified", (code, body))
    code, body, _ = operator.req("POST", f"/documents/{doc_id}/verify", {})
    check("verify again 409", code == 409 and body.get("error") == "invalid_transition" and body.get("from") == "verified", (code, body))
    code, raw, hdrs = ember.req("GET", f"/documents/{doc_id}/file", raw=True)
    check(
        "open document",
        code == 200 and raw.startswith(b"%PDF-") and hdrs.get("Content-Type") == "application/pdf" and "attachment" in hdrs.get("Content-Disposition", ""),
        (code, hdrs),
    )
    code, raw, _ = saltline.req("GET", f"/documents/{doc_id}/file", raw=True)
    check("another member cannot open 404", code == 404, code)
    code, body, _ = ember.req(
        "POST", "/documents", multipart([("type", "kitchen_agreement")], "a.pdf", pdf),
        content_type=f"multipart/form-data; boundary={boundary}",
    )
    check("member agreement upload 403", code == 403, (code, body))

    print("\n== rate cards (DP-38..40)")
    code, body, _ = operator.req("GET", "/kitchens/kit-nsc/rate-cards")
    seed_card = [c for c in body["rate_cards"] if c["id"] == "rc-nsc-seed"][0]
    check("seed rate card in force", seed_card["in_force"] is True and seed_card["tier_rates_cents"] == [3200, 2950, 2725, 2500], seed_card)
    future = fresh_date(30, today)
    code, kitchen_body, _ = ember.req("GET", "/kitchens/kit-nsc")
    new_card = {
        "effective_from": future,
        "tier_rates_cents": [4000, 3600, 3300, 3000],
        "station_surcharges_cents": {s["id"]: 500 for s in kitchen_body["kitchen"]["stations"]},
        "cancellation_window_hours": 48,
        "pack_price_cents": 60000,
    }
    code, body, _ = operator.req("POST", "/kitchens/kit-nsc/rate-cards", new_card)
    check("add rate card 201", code == 201 and body["rate_card"]["effective_from"] == future, (code, body))
    code, body, _ = operator.req("POST", "/kitchens/kit-nsc/rate-cards", new_card)
    check("duplicate rate card 409", code == 409 and body.get("error") == "rate_card_exists", (code, body))
    bad_card = dict(new_card)
    bad_card["effective_from"] = "2020-01-01"
    code, body, _ = operator.req("POST", "/kitchens/kit-nsc/rate-cards", bad_card)
    check("rate card before today 422", code == 422, (code, body))
    code, body, _ = operator.req("GET", "/kitchens/kit-nsc/rate-cards")
    check("rate cards newest first", body["rate_cards"][0]["effective_from"] == future, [c["effective_from"] for c in body["rate_cards"]])
    code, body, _ = ember.req("GET", "/bookings")
    check("earlier bookings keep old card", all(b["rate_card_id"] == "rc-nsc-seed" for b in body["bookings"]), [b["rate_card_id"] for b in body["bookings"]])

    print("\n== series (DP-41..43)")
    d0 = datetime.date.fromisoformat(today)
    while d0.weekday() != 1:
        d0 += datetime.timedelta(days=1)
    first = d0.isoformat()
    code, body, _ = ember.req(
        "POST", "/series/quote", {"station_ids": ["st-prep-b"], "start": "04:30", "end": "06:30", "first_date": first, "weeks": 4, "use_pack": False}
    )
    occ = body["occurrences"]
    check("series quote 4 occurrences", len(occ) == 4 and occ[0]["date"] == first, [o["date"] for o in occ])
    check("occurrences same wall clock", all(o["quote"]["quarters"] == 8 for o in occ), [o["starts_at"] for o in occ])
    total = body["total_cents"]
    code, body, _ = ember.req(
        "POST",
        "/series",
        {
            "station_ids": ["st-prep-b"],
            "start": "04:30",
            "end": "06:30",
            "first_date": first,
            "weeks": 4,
            "use_pack": False,
            "quoted_total_cents": total,
        },
        headers={"Idempotency-Key": "series-" + rand_key()},
    )
    check("series booked", code == 201 and len(body["bookings"]) == 4, (code, body.get("error")))
    series_bookings = body["bookings"]
    gaps_ok = all(
        (datetime.datetime.fromisoformat(b["ends_at"].replace("Z", "+00:00")) - datetime.datetime.fromisoformat(b["starts_at"].replace("Z", "+00:00"))).total_seconds() == 7200
        for b in series_bookings
    )
    check("each occurrence exactly 2h (wall clock constant)", gaps_ok, [b["starts_at"] for b in series_bookings])
    check("one invoice for series", len({b["invoice_id"] for b in series_bookings}) == 1, [b["invoice_id"] for b in series_bookings])
    code, body, _ = ember.req("POST", "/series/quote", {"station_ids": ["st-prep-b"], "start": "04:30", "end": "06:30", "first_date": first, "weeks": 1, "use_pack": False})
    check("weeks 1 422", code == 422, (code, body))

    print("\n== operator loom view (DP-54)")
    d = series_bookings[0]["date"]
    code, body, _ = operator.req("GET", f"/kitchens/kit-nsc/loom?date={d}")
    named = [c for c in body["cells"] if c.get("business")]
    check("operator sees business names", len(named) > 0, body["cells"][:3])
    code, body, _ = wren.req("GET", f"/kitchens/kit-nsc/loom?date={d}")
    anonymous = [c for c in body["cells"] if c["state"] == "taken"]
    check(
        "member sees taken anonymously",
        len(anonymous) > 0 and all("business" not in c and "booking_id" not in c and "hold_id" not in c and "member_id" not in c for c in anonymous),
        anonymous[:3],
    )

    print("\n== reports (DP-57/58)")
    month = today[:7]
    code, body, _ = ines.req("GET", f"/kitchens/kit-nsc/reports/usage?month={month}")
    check("bookkeeper report ok", code == 200 and body["month"] == month, (code,))
    check("no larkspur in report", "Larkspur" not in json.dumps(body), None)
    check(
        "report invoices carry killbill ids",
        all((i["killbill_invoice_id"] is not None) == (i["total_cents"] > 0) for i in body["invoices"]),
        body["invoices"],
    )
    code, raw, hdrs = ines.req("GET", f"/kitchens/kit-nsc/reports/usage.csv?month={month}", raw=True)
    text = raw.decode()
    lines = text.strip().split("\r\n")
    check("csv header exact", lines[0] == "invoice_ref,kind,member,booking_ref,date,station,tier,paid_by,hours,amount", lines[0])
    check("csv filename", f"pilotlight-usage-kit-nsc-{month}.csv" in hdrs.get("Content-Disposition", ""), hdrs.get("Content-Disposition"))
    check("csv rows exist", len(lines) - 1 > 0, len(lines))
    code, body, _ = ines.req("GET", f"/kitchens/kit-lark/reports/usage?month={month}")
    check("larkspur report 404 for ines", code == 404, code)
    code, body, _ = ember.req("GET", f"/kitchens/kit-nsc/reports/usage?month={month}")
    check("member reports 403", code == 403, code)

    print("\n== emails (DP-30/47)")
    with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=100", timeout=10) as resp:
        messages = json.loads(resp.read())
    subjects = [m["Subject"] for m in messages["messages"]]
    check("confirmation emails exist", any("confirmed" in s for s in subjects), subjects[:8])
    check("series email exists", any("Weekly series" in s for s in subjects), subjects[:8])
    check("cancellation receipt exists", any("cancelled" in s for s in subjects), subjects[:8])
    check("reminder emails exist", any("expires" in s for s in subjects), subjects[:8])
    check("each message one recipient", all(len(m["To"]) == 1 for m in messages["messages"]), [m["To"] for m in messages["messages"]])

    print(f"\n===== RESULTS: {results['pass']} passed, {results['fail']} failed =====")
    return 0 if results["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
