"""Lookups, supersession, relations, history and the graph read model.

One place decides supersession: active_at below.
"""
from .api import fail
from .textutil import entity_key, now, dt_to_str


async def get_database(ctx, name, *, for_update=False):
    """One database of the caller's organization inside key scope, or 404."""
    actor = ctx.actor
    db = ctx.db
    if actor["key_scope"] is not None and name not in actor["key_scope"]:
        fail(404, "DATABASE_NOT_FOUND", "Database not found")
    clause = "FOR UPDATE" if for_update else ""
    row = await db.fetchrow(
        "SELECT id, organization_id, name, created_at, ready_at, last_lsn, indexed_lsn, "
        "index_generation FROM app.databases WHERE organization_id = $1 AND name = $2 " + clause,
        actor["organization_id"], name)
    if row is None:
        fail(404, "DATABASE_NOT_FOUND", "Database not found")
    return row


def db_status(row):
    return "provisioning" if now() < row["ready_at"] else "ready"


def require_ready(row):
    if now() < row["ready_at"]:
        fail(409, "DATABASE_NOT_READY", "This database is still provisioning")


async def live_facts(db, database_id):
    """Facts of live sources in log order, with keys and display names."""
    return await db.fetch(
        "SELECT lsn, position, source_id, subject, subject_key, object, object_key, "
        "predicate, valid_from, reason FROM app.facts "
        "WHERE database_id = $1 AND source_live ORDER BY lsn, position", database_id)


def active_at(facts, as_of, subject_key=None, predicate=None):
    """The active fact per (subject key, predicate) at as_of, ties by lsn then position."""
    best = {}
    for f in facts:
        if f["valid_from"] > as_of:
            continue
        if subject_key is not None and f["subject_key"] != subject_key:
            continue
        if predicate is not None and f["predicate"] != predicate:
            continue
        k = (f["subject_key"], f["predicate"])
        cur = best.get(k)
        if cur is None or (f["valid_from"], f["lsn"], f["position"]) > \
                (cur["valid_from"], cur["lsn"], cur["position"]):
            best[k] = f
    return best


def active_edges(facts, as_of):
    """Every edge active at as_of as a list of fact rows, one per (subject, predicate)."""
    best = active_at(facts, as_of)
    return list(best.values())


def display_names(facts):
    """Key -> display name of the earliest appearance by (lsn, position)."""
    names = {}
    for f in sorted(facts, key=lambda f: (f["lsn"], f["position"])):
        for disp, key in ((f["subject"], f["subject_key"]), (f["object"], f["object_key"])):
            if key not in names:
                names[key] = disp
    return names


def display_of(facts):
    return display_names(facts)


def relations_of(facts, as_of, key):
    """Outgoing and incoming relation rows of an entity at as_of, in pinned order."""
    best = active_at(facts, as_of)
    out = []
    inc = []
    for f in best.values():
        if f["subject_key"] == key:
            out.append({"predicate": f["predicate"], "other": f["object"],
                        "other_key": f["object_key"], "valid_from": f["valid_from"],
                        "reason": f["reason"], "source_id": f["source_id"]})
        if f["object_key"] == key:
            inc.append({"predicate": f["predicate"], "other": f["subject"],
                        "other_key": f["subject_key"], "valid_from": f["valid_from"],
                        "reason": f["reason"], "source_id": f["source_id"]})
    out.sort(key=lambda r: (r["predicate"], r["other_key"]))
    inc.sort(key=lambda r: (r["predicate"], r["other_key"]))
    return out, inc


def history_of(facts, key, predicate):
    """Every live fact for one subject key and predicate, with superseded_at."""
    rows = [f for f in facts if f["subject_key"] == key and f["predicate"] == predicate]
    rows.sort(key=lambda f: (f["valid_from"], f["lsn"], f["position"]))
    entries = []
    for i, f in enumerate(rows):
        superseded = rows[i + 1]["valid_from"] if i + 1 < len(rows) else None
        entries.append({"object": f["object"], "valid_from": f["valid_from"],
                        "superseded_at": superseded, "reason": f["reason"],
                        "source_id": f["source_id"], "lsn": f["lsn"]})
    return entries


def resolve_key(facts, name):
    """Case-insensitive, space-trimming lookup of an entity name."""
    return entity_key(name)


def ts(v):
    return dt_to_str(v)
