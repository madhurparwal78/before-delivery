"""Read models: the fleet context and the JSON shapes of the API (brief: API, Body shapes)."""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from . import clock, rules
from .rules import tag


@dataclass
class Fleet:
    now: datetime
    tails: dict[str, rules.Tail]
    directives: dict[str, dict]
    order: list[str]
    people: dict[str, dict]


async def load_fleet(conn) -> Fleet:
    """Everything a compliance computation needs, read in a handful of queries."""
    logs: dict[str, list] = {}
    for r in await conn.fetch("SELECT registration, logged_at, total_after FROM flight_hours ORDER BY id"):
        logs.setdefault(r["registration"], []).append((r["logged_at"], r["total_after"]))
    tails = {}
    for r in await conn.fetch("SELECT * FROM tails ORDER BY registration"):
        log = tuple(logs.get(r["registration"], ()))
        total = log[-1][1] if log else r["seed_hours"]
        tails[r["registration"]] = rules.Tail(r["registration"], r["model"], r["msn"], total,
                                              r["daily_utilisation"], log)
    directives, order = {}, []
    for r in await conn.fetch(
            "SELECT * FROM directives ORDER BY array_position($1::text[], authority), seq", list(rules.AUTHORITIES)):
        directives[r["id"]] = {**dict(r), "revisions": {}}
        order.append(r["id"])
    for r in await conn.fetch(
            "SELECT r.*, d.key AS document_key FROM revisions r LEFT JOIN documents d ON d.id = r.document_id"):
        directives[r["directive_id"]]["revisions"][r["revision"]] = dict(r)
    people = {r["id"]: dict(r) for r in await conn.fetch("SELECT * FROM users ORDER BY seq")}
    return Fleet(clock.now(), tails, directives, order, people)


SYSTEM_ACTOR = {"id": "system", "display_name": "Tailboard", "licence": None, "erased": False}


def person(fleet: Fleet, user_id: str | None) -> dict | None:
    if user_id is None:
        return None
    u = fleet.people[user_id]
    return person_of(u)


def person_of(u) -> dict:
    return {"id": u["id"], "display_name": u["display_name"], "licence": u["licence"], "erased": u["erased"]}


def user_of(u) -> dict:
    return {**person_of(u), "username": u["username"], "role": u["role"], "contractor": u["contractor"],
            "email": u["email"], "scope": list(u["scope"]) if u["scope"] is not None else None}


def directive_name(d: dict) -> str:
    return f"{d['authority']} {d['number']}"


def rule_of(revision: dict) -> rules.Rule:
    return rules.Rule(revision["effective_date"], revision["calendar_days"], Decimal(revision["fh_interval"]))


def status(fleet: Fleet, t, at: datetime | None = None) -> dict:
    """State, label, limits, governing limit and rails of one thread, judged by the server clock."""
    d = fleet.directives[t["directive_id"]]
    stage = t["stage"]
    if t["frozen"] is not None:
        result = {**t["frozen"], "past_due": False, "due_soon": False}
    else:
        rule = rule_of(d["revisions"][t["rule_revision"]])
        result = rules.evaluate(rule, Decimal(t["fh_baseline"]), t["deferred"], t["entered_at"],
                                fleet.tails[t["registration"]], at or fleet.now)
    state = rules.reported_state(stage, result["past_due"])
    return {
        **result,
        "stage": stage,
        "state": state,
        "label": rules.label(stage, state, result["due_soon"]),
        "governing": None if stage in rules.UNCOUNTED else result["governing"],
        "bucket": rules.count_bucket(stage, state, result["due_soon"]),
    }


def revision_limits(fleet: Fleet, t) -> dict:
    """The limits a thread lived under in its governing revision, as history records them: the limits in force
    when it left that revision, a deferral's grace included."""
    if t["frozen"] is not None:
        return t["frozen"]["limits"]
    rule = rule_of(fleet.directives[t["directive_id"]]["revisions"][t["rule_revision"]])
    return rules.evaluate(rule, Decimal(t["fh_baseline"]), t["deferred"], t["entered_at"],
                          fleet.tails[t["registration"]], fleet.now)["limits"]


def cell(fleet: Fleet, t, s: dict) -> dict:
    d = fleet.directives[t["directive_id"]]
    return {
        "thread_id": t["id"], "registration": t["registration"], "directive_id": t["directive_id"],
        "state": s["state"], "stage": s["stage"], "label": s["label"], "revision": tag(d["current_revision"]),
        "pinned_revision": tag(t["rule_revision"]) if t["pinned"] else None, "governing": s["governing"],
        "calendar_used": s["calendar_used"], "hours_used": s["hours_used"], "due_at": s["limits"]["due_at"],
    }


def wording(fleet: Fleet, t) -> dict:
    revision = fleet.directives[t["directive_id"]]["revisions"][t["rule_revision"]]
    return {"title": revision["title"], "method": revision["method"]}


def directive_json(fleet: Fleet, d: dict) -> dict:
    current = d["revisions"][d["current_revision"]]
    return {
        "id": d["id"], "authority": d["authority"], "number": d["number"], "title": current["title"],
        "revision": tag(d["current_revision"]), "status": d["status"],
        "revisions": [{
            "revision": tag(n), "title": r["title"], "method": r["method"],
            "effective_date": r["effective_date"].isoformat(), "calendar_days": r["calendar_days"],
            "fh_interval": float(r["fh_interval"]), "applicability": r["applicability"],
            "prior_credit": r["prior_credit"], "document_key": r["document_key"],
            "ingested_at": clock.iso(r["ingested_at"]), "ingested_by": person(fleet, r["ingested_by"]),
        } for n, r in sorted(d["revisions"].items())],
    }


def column_entry(fleet: Fleet, d: dict, statuses: list[dict]) -> dict:
    counts = rules.empty_counts()
    for s in statuses:
        if s["bucket"]:
            counts[s["bucket"]] += 1
    return {
        "id": d["id"], "authority": d["authority"], "number": d["number"],
        "title": d["revisions"][d["current_revision"]]["title"], "revision": tag(d["current_revision"]),
        "status": d["status"], "prior_revisions": [tag(n) for n in range(1, d["current_revision"])],
        "counts": counts,
    }


def tails_json(fleet: Fleet) -> list[dict]:
    return [{"registration": t.registration, "model": t.model, "msn": t.msn, "total_hours": float(t.total),
             "daily_utilisation": float(t.utilisation)} for t in fleet.tails.values()]


async def board(conn, fleet: Fleet, directive_id: str | None = None) -> dict:
    query = "SELECT * FROM threads" + (" WHERE directive_id = $1" if directive_id else "") + " ORDER BY registration"
    rows = await conn.fetch(query, *([directive_id] if directive_id else []))
    by_directive: dict[str, list] = {}
    for t in rows:
        by_directive.setdefault(t["directive_id"], []).append((t, status(fleet, t)))
    entries, cells = [], []
    for did in fleet.order:
        if directive_id and did != directive_id:
            continue
        threads = by_directive.get(did, [])
        entries.append(column_entry(fleet, fleet.directives[did], [s for _, s in threads]))
        cells.extend(cell(fleet, t, s) for t, s in threads)
    totals = rules.empty_counts()
    for e in entries:
        for k, v in e["counts"].items():
            totals[k] += v
    return {"generated_at": clock.iso(fleet.now), "as_of": None, "directives": entries, "tails": tails_json(fleet),
            "cells": cells, "totals": totals}


def _legacy_json(r) -> dict:
    return {
        "id": r["id"], "revision": tag(r["revision"]), "status": r["status"], "inspector": r["inspector"],
        "inspector_licence": r["inspector_licence"],
        "inspected_on": r["inspected_on"].isoformat() if r["inspected_on"] else None,
        "certifier": r["certifier"], "certifier_licence": r["certifier_licence"],
        "certified_on": r["certified_on"].isoformat() if r["certified_on"] else None,
        "notes": r["notes"], "import_id": r["import_id"], "row": r["row_number"],
    }


def signature_json(fleet: Fleet, s) -> dict:
    signer = person(fleet, s["signer_id"])
    return {
        "id": s["id"], "kind": s["kind"], "signer": signer,
        "signer_text": signer["display_name"] if signer else s["signer_text"], "revision": tag(s["revision"]),
        "committed_at": clock.iso(s["committed_at"]), "timeliness": s["timeliness"], "method_ref": s["method_ref"],
        "findings": s["findings"], "status": s["status"], "void_reason": s["void_reason"],
    }


def evidence_json(fleet: Fleet, e) -> dict:
    return {"id": e["id"], "key": e["key"], "sha256": e["sha256"], "content_type": e["content_type"],
            "bytes": e["bytes"], "attached_by": person(fleet, e["attached_by"]),
            "attached_at": clock.iso(e["attached_at"])}


async def threads_json(conn, fleet: Fleet, rows) -> list[dict]:
    """Full Thread bodies for the given thread rows, with their work, signatures and past."""
    ids = [t["id"] for t in rows]
    grouped: dict[str, dict[str, list]] = {i: {"sig": [], "ev": [], "hist": [], "legacy": []} for i in ids}
    for name, query in (("sig", "SELECT * FROM signatures WHERE thread_id = ANY($1) ORDER BY seq"),
                        ("ev", "SELECT * FROM evidence WHERE thread_id = ANY($1) ORDER BY seq"),
                        ("hist", "SELECT * FROM thread_history WHERE thread_id = ANY($1) ORDER BY revision"),
                        ("legacy", "SELECT * FROM legacy_records WHERE thread_id = ANY($1) ORDER BY seq")):
        for r in await conn.fetch(query, ids):
            grouped[r["thread_id"]][name].append(r)
    out = []
    for t in rows:
        g = grouped[t["id"]]
        d = fleet.directives[t["directive_id"]]
        s = status(fleet, t)
        tail = fleet.tails[t["registration"]]
        legacy = [_legacy_json(r) for r in g["legacy"]]
        current_wording = wording(fleet, t)
        history = [{
            "revision": tag(h["revision"]), "entered_at": clock.iso(h["entered_at"]),
            "left_at": clock.iso(h["left_at"]), "limits": h["limits"], "wording": h["wording"],
            "outcome": h["outcome"], "legacy_records": [x for x in legacy if x["revision"] == tag(h["revision"])],
        } for h in g["hist"]]
        history.append({
            "revision": tag(d["current_revision"]), "entered_at": clock.iso(t["entered_at"]), "left_at": None,
            "limits": s["limits"], "wording": current_wording, "outcome": "current",
            "legacy_records": [x for x in legacy if x["revision"] == tag(d["current_revision"])],
        })
        out.append({
            "id": t["id"], "registration": t["registration"], "model": tail.model, "msn": tail.msn,
            "directive_id": d["id"], "directive": directive_name(d), "state": s["state"], "stage": s["stage"],
            "label": s["label"], "revision": tag(d["current_revision"]),
            "pinned_revision": tag(t["rule_revision"]) if t["pinned"] else None,
            "governing_revision": tag(t["rule_revision"]), "governing": s["governing"],
            "wording": current_wording, "limits": s["limits"], "timeliness": t["timeliness"],
            "work_card": {"id": t["work_card_id"], "holder": person(fleet, t["holder_id"]),
                          "claimed_at": clock.iso(t["claimed_at"])},
            "evidence": [evidence_json(fleet, e) for e in g["ev"]],
            "signatures": [signature_json(fleet, x) for x in g["sig"]],
            "certifier": {"assigned": person(fleet, t["certifier_id"]), "status": t["certifier_status"]},
            "deferral": ({"granted_by": person(fleet, t["deferral_by"]), "granted_at": clock.iso(t["deferral_at"]),
                          "reason": t["deferral_reason"]} if t["deferral_by"] else None),
            "history": history, "legacy_records": legacy,
        })
    return out


async def thread_json(conn, fleet: Fleet, thread_id: str) -> dict:
    row = await conn.fetchrow("SELECT * FROM threads WHERE id = $1", thread_id)
    return (await threads_json(conn, fleet, [row]))[0]
