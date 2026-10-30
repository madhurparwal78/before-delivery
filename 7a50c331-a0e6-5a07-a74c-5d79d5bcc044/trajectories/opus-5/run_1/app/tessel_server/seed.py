"""The idempotent seed: two organizations, their members and their databases."""
from . import auth, config, db, textutil
from .auth import Actor
from .domain import databases, sources

ORGANIZATIONS = (
    (
        "Northwind Labs",
        "ship",
        (
            ("northwind.owner@example.com", "owner"),
            ("northwind.editor@example.com", "editor"),
            ("northwind.viewer@example.com", "viewer"),
        ),
    ),
    ("Acme Ops", "scale", (("acme.owner@example.com", "owner"),)),
)

NORTHWIND_SOURCES = (
    {
        "id": "kickoff-notes",
        "title": "Atlas launch kickoff",
        "text": (
            "Priya Raman owns the Atlas launch. The launch is blocked by the billing "
            "migration, which Marco Silva owns."
        ),
        "facts": (
            ("Atlas Launch", "OWNED_BY", "Priya Raman", "2026-01-05T09:00:00Z", "Kickoff assignment"),
            ("Billing Migration", "OWNED_BY", "Marco Silva", "2026-01-05T09:00:00Z", "Kickoff assignment"),
            ("Atlas Launch", "BLOCKED_BY", "Billing Migration", "2026-02-01T00:00:00Z", "Invoices must move first"),
        ),
    },
    {
        "id": "reorg-memo",
        "title": "Platform reorg memo",
        "text": (
            "Priya Raman moved to the platform team. Dana Okafor now owns the Atlas launch."
        ),
        "facts": (
            ("Atlas Launch", "OWNED_BY", "Dana Okafor", "2026-03-10T12:00:00Z", "Priya moved to the platform team"),
        ),
    },
    {
        "id": "billing-standup",
        "title": "Billing standup notes",
        "text": (
            "The billing migration depends on the ledger service. Marco Silva owns the "
            "ledger service too."
        ),
        "facts": (
            ("Billing Migration", "DEPENDS_ON", "Ledger Service", "2026-03-14T10:00:00Z", "Standup finding"),
            ("Ledger Service", "OWNED_BY", "Marco Silva", "2026-03-14T10:00:00Z", "Standup finding"),
        ),
    },
    {
        "id": "launch-retro",
        "title": "Atlas launch retro",
        "text": (
            "The billing migration shipped. The Atlas launch is now blocked by the "
            "security review, owned by Lena Brandt."
        ),
        "facts": (
            ("Atlas Launch", "BLOCKED_BY", "Security Review", "2026-04-02T15:30:00Z", "Billing migration shipped"),
            ("Security Review", "OWNED_BY", "Lena Brandt", "2026-04-02T15:30:00Z", "Retro assignment"),
        ),
    },
)

ACME_SOURCES = (
    {
        "id": "acme-plan",
        "title": "Acme rollout plan",
        "text": "The rollout is owned by Jordan Lee.",
        "facts": (
            ("Acme Rollout", "OWNED_BY", "Jordan Lee", "2026-02-01T00:00:00Z", "Plan of record"),
        ),
    },
)


def _parsed(described):
    return [
        {
            "id": source["id"],
            "title": source["title"],
            "text": source["text"],
            "if_version": None,
            "relations": None,
            "facts": [
                {
                    "subject": subject,
                    "subject_key": textutil.entity_key(subject),
                    "predicate": predicate,
                    "object": obj,
                    "object_key": textutil.entity_key(obj),
                    "valid_from": textutil.parse_timestamp(valid_from),
                    "reason": reason,
                }
                for subject, predicate, obj, valid_from, reason in source["facts"]
            ],
        }
        for source in described
    ]


def _seed_organization(cur, name, plan, people):
    organization = cur.one(
        """
        INSERT INTO organizations (name, plan, created_at) VALUES (%s, %s, %s)
        RETURNING id, name, plan
        """,
        (name, plan, textutil.now()),
    )
    password_hash = auth.hash_password(config.SEED_PASSWORD)
    for email, role in people:
        cur.execute(
            """
            INSERT INTO members (organization_id, email, role, password_hash, created_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (organization["id"], email, role, password_hash, textutil.now()),
        )
    return organization


def apply():
    """Create the seed once; a later start changes nothing."""
    with db.tx() as cur:
        cur.value("SELECT pg_advisory_xact_lock(3625001)")
        if cur.value("SELECT 1 FROM organizations WHERE name = %s", ("Northwind Labs",)):
            return
        for name, plan, people in ORGANIZATIONS:
            organization = _seed_organization(cur, name, plan, people)
            owner = cur.one(
                """
                SELECT id, email, role FROM members
                 WHERE organization_id = %s AND role = 'owner'
                """,
                (organization["id"],),
            )
            actor = Actor("session", "owner", organization, member=owner)
            row = databases.create(cur, actor, "launch_brain", ready_immediately=True)
            described = NORTHWIND_SOURCES if name == "Northwind Labs" else ACME_SOURCES
            sources.perform_ingest(
                cur, row, databases.DEFAULT_COLLECTION, _parsed(described)
            )
            if name == "Northwind Labs":
                databases.compact(cur, row["id"])
