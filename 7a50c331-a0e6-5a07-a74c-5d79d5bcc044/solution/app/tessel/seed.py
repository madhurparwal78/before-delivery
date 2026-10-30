"""The idempotent seed: both organizations, their members and both launch_brain databases (brief: Seed data)."""
from datetime import datetime, timezone

from . import api, db, security, text, writelog

SEED_PASSWORD = "deku-demo-pw-2026"
READY_SINCE = datetime(2026, 1, 1, tzinfo=timezone.utc)

ORGANIZATIONS = [
    ("Northwind Labs", "ship", [("northwind.owner@example.com", "owner"), ("northwind.editor@example.com", "editor"),
                                ("northwind.viewer@example.com", "viewer")]),
    ("Acme Ops", "scale", [("acme.owner@example.com", "owner")]),
]

NORTHWIND_SOURCES = [
    ("kickoff-notes", "Atlas launch kickoff",
     "Priya Raman owns the Atlas launch. The launch is blocked by the billing migration, which Marco Silva owns.",
     [("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "Kickoff assignment"),
      ("Billing Migration", "OWNED_BY", "Marco Silva", "2026-01-05T09:00:00Z", "Kickoff assignment"),
      ("Atlas Launch", "BLOCKED_BY", "Billing Migration", "2026-02-01T00:00:00Z", "Invoices must move first")]),
    ("reorg-memo", "Platform reorg memo",
     "Priya Raman moved to the platform team. Dana Okafor now owns the Atlas launch.",
     [("Atlas Launch", "OWNED_BY", "Dana Okafor", "2026-03-10T12:00:00Z", "Priya moved to the platform team")]),
    ("billing-standup", "Billing standup notes",
     "The billing migration depends on the ledger service. Marco Silva owns the ledger service too.",
     [("Billing Migration", "DEPENDS_ON", "Ledger Service", "2026-03-14T10:00:00Z", "Standup finding"),
      ("Ledger Service", "OWNED_BY", "Marco Silva", "2026-03-14T10:00:00Z", "Standup finding")]),
    ("launch-retro", "Atlas launch retro",
     "The billing migration shipped. The Atlas launch is now blocked by the security review, owned by Lena Brandt.",
     [("Atlas Launch", "BLOCKED_BY", "Security Review", "2026-04-02T15:30:00Z", "Billing migration shipped"),
      ("Security Review", "OWNED_BY", "Lena Brandt", "2026-04-02T15:30:00Z", "Retro assignment")]),
]
ACME_SOURCES = [
    ("acme-plan", "Acme rollout plan", "The rollout is owned by Jordan Lee.",
     [("Acme Rollout", "OWNED_BY", "Jordan Lee", "2026-02-01T00:00:00Z", "Plan of record")]),
]
LAUNCH_BRAIN = {"Northwind Labs": (NORTHWIND_SOURCES, True), "Acme Ops": (ACME_SOURCES, False)}


def _launch_brain(t: db.Tx, org_id: int, org_name: str, plan: str) -> None:
    sources, compacted = LAUNCH_BRAIN[org_name]
    owner = api.Principal("member", org_id, org_name, plan, "owner")
    row = writelog.create(t, owner, "launch_brain")
    t.run("UPDATE databases SET created_at = :at WHERE id = :d", at=READY_SINCE, d=row["id"])
    for sid, title, body, facts in sources:
        writelog.ingest(t, org_id, row, "default", [{
            "id": sid, "title": title, "text": body,
            "facts": [{"subject": s, "predicate": p, "object": o, "valid_from": text.parse_ts(v), "reason": r}
                      for s, p, o, v, r in facts]}])
    if compacted:
        writelog.compact(t, row)


def seed() -> None:
    with db.tx() as t:
        t.run("SELECT pg_advisory_xact_lock(731102)")
        if t.one("SELECT 1 AS x FROM organizations WHERE name = 'Northwind Labs'"):
            return
        password_hash = security.hash_password(SEED_PASSWORD)
        for name, plan, members in ORGANIZATIONS:
            org_id = t.one("INSERT INTO organizations (name, plan) VALUES (:n, :p) RETURNING id", n=name, p=plan)["id"]
            for email, role in members:
                t.run("INSERT INTO members (organization_id, email, role, password_hash) VALUES (:o, :e, :r, :h)",
                      o=org_id, e=email, r=role, h=password_hash)
            _launch_brain(t, org_id, name, plan)
