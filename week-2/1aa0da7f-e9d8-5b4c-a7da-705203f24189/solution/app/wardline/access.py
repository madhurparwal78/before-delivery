"""Who can do what: grants, scopes and the role table, decided here and nowhere else."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import unquote

import asyncpg

from wardline import fields, ledger
from wardline.web import Request

_ID = re.compile(r"[A-Z]{2,3}-[0-9]{2,12}")

_INTAKE = frozenset({"intake_officer"})
_LEAD = frozenset({"case_lead"})
_AUDITOR = frozenset({"auditor"})
_WORKERS = frozenset({"investigator", "case_lead"})
FULL, ORIGINAL, ANY = "full", "original", "any"

# action -> (roles, what scope it needs). ORIGINAL answers not_found to a derivatives-scoped member.
ACTIONS: dict[str, tuple[frozenset[str], str]] = {
    "register": (_INTAKE, FULL),
    "clear": (_INTAKE, FULL),
    "refuse": (_INTAKE, FULL),
    "manage_grants": (_LEAD, FULL),
    "hold": (_LEAD, FULL),
    "lift_hold": (_LEAD, FULL),
    "dispose": (_LEAD, FULL),
    "sign_off": (_LEAD, FULL),
    "reject": (_LEAD, FULL),
    "share": (_LEAD, FULL),
    "withdraw": (_LEAD, FULL),
    "preview": (_WORKERS, ORIGINAL),
    "find_text": (_WORKERS, ORIGINAL),
    "redact": (_WORKERS, ORIGINAL),
    "render": (_WORKERS, ORIGINAL),
    "download_original": (_WORKERS | _INTAKE, ORIGINAL),
    "work_release": (_WORKERS, ANY),
    "read_access_list": (_LEAD, FULL),
    "read_custody": (_LEAD, ORIGINAL),
}
# action -> roles, for what takes no grant on a compartment.
ROLE_ACTIONS: dict[str, frozenset[str]] = {
    "create_compartment": _LEAD,
    "read_directory": _LEAD,
    "read_review_queue": _LEAD,
    "end_sessions": _LEAD,
    "open_break_glass": _LEAD,
    "read_ledger": _AUDITOR,
    "read_any_custody": _AUDITOR,
}
BREAK_GLASS_REFUSED = frozenset({"manage_grants", "sign_off", "reject", "share", "withdraw"})
LANDING = {"intake_officer": "/intake", "case_lead": "/compartments", "investigator": "/compartments", "auditor": "/ledger"}
_NEXT_SHAPES = (
    (re.compile(r"/compartments(/CMP-[0-9]{4,})?"), None),
    (re.compile(r"/exhibits/EX-[0-9]{4,}"), None),
    (re.compile(r"/releases/REL-[0-9]{4,}"), None),
    (re.compile(r"/intake"), "intake_officer"),
    (re.compile(r"/reviews"), "case_lead"),
    (re.compile(r"/ledger|/ledger/review|/audit/chain"), "auditor"),
)
# SQL: a grant still marked active whose time has passed, on the server's clock.
GRANT_PAST_TIME = "state = 'active' AND expires_at <= now()"


@dataclass(frozen=True, slots=True)
class ActiveGrant:
    grant_id: str
    scope: str
    kind: str

    @property
    def break_glass(self) -> bool:
        return self.kind == "break_glass"


def safe_landing(role: str, requested: object) -> str:
    """`next` decoded once, only if it is a published route shape open to this role."""
    if isinstance(requested, str):
        address = unquote(requested, errors="surrogateescape")
        for shape, owner in _NEXT_SHAPES:
            if shape.fullmatch(address) and owner in (None, role):
                return address
    return LANDING[role]


def well_formed(identifier: object) -> bool:
    return isinstance(identifier, str) and _ID.fullmatch(identifier) is not None


def grant_in_force(alias: str = "") -> str:
    """SQL for the one rule of a grant in force: active, and not past its lapse time on the server's clock."""
    prefix = f"{alias}." if alias else ""
    return f"{prefix}state = 'active' AND ({prefix}expires_at IS NULL OR {prefix}expires_at > now())"


def link_in_force() -> str:
    """SQL for the one rule of a live share link; `l` is the link and `r` its release."""
    return "l.active AND l.expires_at > now() AND r.state = 'shared'"


def grant_past_time(grant: asyncpg.Record) -> bool:
    return grant["expires_at"] is not None and grant["expires_at"] <= fields.now()


def ended_state(kind: str) -> str:
    return "ended" if kind == "break_glass" else "lapsed"


async def entry(conn: asyncpg.Connection, request: Request, action: str, target: str, detail: dict | None = None) -> None:
    """Append this request's own entry, attributed to the caller and naming any break-glass grant it was made under."""
    person = request.person
    await ledger.append(conn, actor_id=person.id, session_id=person.session_id, action=action, target=target,
                        detail=request.via(detail or {}))


async def active_grant_on(conn: asyncpg.Connection, compartment_id: str, user_id: str) -> ActiveGrant | None:
    row = await conn.fetchrow(
        f"""SELECT id, scope, kind FROM grants
            WHERE compartment_id = $1 AND user_id = $2 AND {grant_in_force()}""",
        compartment_id,
        user_id,
    )
    return ActiveGrant(row["id"], row["scope"], row["kind"]) if row else None


async def require_grant(request: Request, conn: asyncpg.Connection, compartment_id: str, identifier: str) -> ActiveGrant:
    """The caller's standing on a compartment. No grant looks exactly like an unknown id."""
    standing = await active_grant_on(conn, compartment_id, request.person.id)
    if standing is None:
        raise request.not_found(identifier)
    request.break_glass_grant = standing.grant_id if standing.break_glass else None
    return standing


async def end_past_grant(conn: asyncpg.Connection, row: asyncpg.Record) -> None:
    """Moves a grant past its time to its end state, once however many sweeps and writers reach it."""
    ended = await conn.fetchval(
        "UPDATE grants SET state = $2 WHERE id = $1 AND state = 'active' RETURNING 1",
        row["id"], ended_state(row["kind"]),
    )
    if not ended:
        return
    if row["kind"] == "break_glass":
        await ledger.append(conn, actor_id="system", session_id=None, action="break_glass.ended", target=row["id"])
    else:
        await ledger.append(conn, actor_id="system", session_id=None, action="grant.lapsed", target=row["id"],
                            detail={"compartment_id": row["compartment_id"], "user_id": row["user_id"]})


def may(request: Request, action: str) -> bool:
    return request.person.role in ROLE_ACTIONS[action]


def require_role(request: Request, action: str) -> None:
    if not may(request, action):
        raise request.forbidden()


def can_read_access_list(request: Request, standing: ActiveGrant) -> bool:
    roles, _ = ACTIONS["read_access_list"]
    return request.person.role in roles and standing.scope == "full"


def authorise(request: Request, standing: ActiveGrant, action: str, identifier: str | None = None) -> None:
    roles, scope = ACTIONS[action]
    if scope == ORIGINAL and standing.scope != "full":
        raise request.not_found(identifier if identifier is not None else list(request.params.values())[-1])
    if request.person.role not in roles:
        raise request.forbidden()
    if scope == FULL and standing.scope != "full":
        raise request.forbidden()
    if standing.break_glass and action in BREAK_GLASS_REFUSED:
        raise request.forbidden()


def authorise_disposal(request: Request, standing: ActiveGrant, *, held: bool) -> None:
    """Under break-glass only a propose or confirm on a held exhibit gets as far as its legal_hold answer."""
    authorise(request, standing, "dispose")
    if standing.break_glass and not held:
        raise request.forbidden()


async def load_compartment(request: Request, conn: asyncpg.Connection, compartment_id: str, *, lock: bool = False) -> asyncpg.Record:
    """A compartment the caller may enter; an existing one is locked when asked."""
    if not well_formed(compartment_id):
        raise request.not_found(compartment_id)
    suffix = " FOR UPDATE" if lock else ""
    row = await conn.fetchrow(f"SELECT * FROM compartments WHERE id = $1{suffix}", str(compartment_id))
    if row is None:
        raise request.not_found(compartment_id)
    return row
