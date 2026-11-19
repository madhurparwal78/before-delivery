"""People: sign-in and sessions, certification scopes with succession, contractor erasure."""

import hashlib
import secrets

from . import clock, db, notices, packs, passcodes, rules, views
from .errors import ApiError, invalid, reason as require_reason
from .threads import standby_list


def _session_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def identity_hash(text: str) -> str:
    return hashlib.sha256(text.strip().lower().encode()).hexdigest()


async def sign_in(conn, body: dict) -> tuple[dict, str]:
    username, passcode = body.get("username"), body.get("passcode")
    user = (await conn.fetchrow("SELECT * FROM users WHERE username = $1", username)
            if isinstance(username, str) and isinstance(passcode, str) else None)
    if user is None or user["erased"] or not passcodes.verify(passcode, user["passcode_hash"]):
        raise ApiError("bad_credentials")
    token = secrets.token_urlsafe(32)
    await conn.execute("INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1, $2, $3)",
                       _session_hash(token), user["id"], clock.now())
    return views.user_of(user), token


async def session_user(conn, token: str | None) -> dict | None:
    if not token:
        return None
    row = await conn.fetchrow("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1",
                              _session_hash(token))
    return dict(row) if row and not row["erased"] else None


async def sign_out(conn, token: str) -> None:
    await conn.execute("DELETE FROM sessions WHERE token_hash = $1", _session_hash(token))


async def _assign(conn, fleet, t, engineer, previous_id: str | None, user: dict) -> dict:
    await conn.execute("UPDATE threads SET certifier_id = $2, certifier_status = $3 WHERE id = $1", t["id"],
                       engineer["id"] if engineer else None,
                       "awaiting_countersignature" if engineer else "awaiting_certifier")
    d = fleet.directives[t["directive_id"]]
    where = f"{t['registration']} {views.directive_name(d)} {rules.tag(d['current_revision'])}"
    if engineer:
        inspector = await conn.fetchval(
            "SELECT signer_id FROM signatures WHERE thread_id = $1 AND kind = 'inspection' AND status = 'valid' "
            "ORDER BY seq DESC LIMIT 1", t["id"])
        await notices.queue(conn, "succession", engineer["id"], {
            "registration": t["registration"], "directive": views.directive_name(d),
            "tag": rules.tag(d["current_revision"]), "inspector_id": inspector, "previous_id": previous_id},
            t["id"])
    await db.audit(conn, user["id"], "thread.certifier_passed",
                   f"{where} now " + ("awaits " + fleet.people[engineer["id"]]["display_name"] if engineer
                                      else "awaits a certifier") + ".", d["id"], t["id"])
    return {"thread_id": t["id"], "from": views.person(fleet, previous_id),
            "to": views.person(fleet, engineer["id"]) if engineer else None}


async def set_scope(conn, user: dict, engineer_id: str, body: dict) -> dict:
    target = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", engineer_id)
    if target is None or target["role"] != "certifying_engineer":
        raise ApiError("not_found")
    rules.require_role(user, "scope")
    models = body.get("models")
    if not isinstance(models, list) or not all(m in rules.MODELS for m in models):
        raise invalid({"models": "Choose from ATR72-212A, DHC-8-402 and ERJ-170-200."})
    scope = [m for m in rules.MODELS if m in models]
    old = set(target["scope"] or [])
    await conn.execute("UPDATE users SET scope = $2 WHERE id = $1", engineer_id, scope)
    fleet = await views.load_fleet(conn)
    succession = []
    for model in rules.MODELS:
        if model in old and model not in scope:
            rows = await conn.fetch(
                "SELECT t.* FROM threads t JOIN tails a ON a.registration = t.registration WHERE t.stage = 'inspected'"
                " AND t.certifier_id = $1 AND a.model = $2 ORDER BY t.registration FOR UPDATE OF t", engineer_id, model)
            standby = await standby_list(conn, model)
            for t in rows:
                engineer = rules.next_certifier(standby, model, skip=engineer_id)
                succession.append(await _assign(conn, fleet, t, engineer, engineer_id, user))
        elif model in scope and model not in old:
            rows = await conn.fetch(
                "SELECT t.* FROM threads t JOIN tails a ON a.registration = t.registration WHERE t.stage = 'inspected'"
                " AND t.certifier_status = 'awaiting_certifier' AND a.model = $1 ORDER BY t.registration"
                " FOR UPDATE OF t", model)
            standby = await standby_list(conn, model)
            for t in rows:
                engineer = rules.next_certifier(standby, model)
                if engineer:
                    succession.append(await _assign(conn, fleet, t, engineer, None, user))
    await db.audit(conn, user["id"], "engineer.scope_changed",
                   f"{target['display_name']} scope: {', '.join(scope) or 'none'}.")
    await db.changed_threads(conn, [s["thread_id"] for s in succession])
    updated = await conn.fetchrow("SELECT * FROM users WHERE id = $1", engineer_id)
    return {"engineer": views.user_of(updated), "succession": succession}


async def _new_token(conn) -> str:
    while True:
        token = "SIGNER-" + secrets.token_hex(4).upper()
        if not await conn.fetchval("SELECT 1 FROM users WHERE display_name = $1 UNION "
                                   "SELECT 1 FROM erased_identities WHERE token = $1", token):
            return token


async def erase(conn, user: dict, person_id: str, body: dict, after_commit: list) -> dict:
    target = await conn.fetchrow("SELECT * FROM users WHERE id = $1 FOR UPDATE", person_id)
    if target is None:
        raise ApiError("not_found")
    rules.require_role(user, "erase")
    if not target["contractor"]:
        raise ApiError("not_contractor")
    if target["erased"]:
        raise ApiError("already_erased")
    reason = require_reason(body, "Give an erasure reason of 1 to 500 characters.")
    token = await _new_token(conn)
    texts = {t.lower() for t in (target["display_name"], target["licence"]) if t}
    for text in texts:
        await conn.execute("INSERT INTO erased_identities (hash, token) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                           identity_hash(text), token)
    await conn.execute(
        "UPDATE users SET display_name = $2, licence = NULL, email = NULL, erased = true, erased_at = $3,"
        " passcode_hash = NULL WHERE id = $1", person_id, token, clock.now())
    await conn.execute("DELETE FROM sessions WHERE user_id = $1", person_id)

    lowered = list(texts)
    await conn.execute("UPDATE signatures SET signer_text = $2 WHERE signer_id IS NULL AND lower(signer_text) = ANY($1)",
                       lowered, token)
    await conn.execute("UPDATE signatures SET licence_text = $2 WHERE lower(licence_text) = ANY($1)", lowered, token)
    for column in ("inspector", "inspector_licence", "certifier", "certifier_licence"):
        await conn.execute(f"UPDATE legacy_records SET {column} = $2 WHERE lower({column}) = ANY($1)", lowered, token)
    for r in await conn.fetch("SELECT id, notes FROM legacy_records WHERE notes <> ''"):
        replaced = packs.replace_texts(r["notes"], texts, token)
        if replaced != r["notes"]:
            await conn.execute("UPDATE legacy_records SET notes = $2 WHERE id = $1", r["id"], replaced)

    held = []
    for t in await conn.fetch("SELECT id, directive_id, work_card_id, stage FROM threads WHERE holder_id = $1 FOR UPDATE",
                              person_id):
        await conn.execute("UPDATE threads SET stage = $2, holder_id = NULL, claimed_at = NULL WHERE id = $1",
                           t["id"], rules.released_by_erasure(t["stage"]))
        await db.audit(conn, user["id"], "thread.released_by_erasure",
                       f"Work card {t['work_card_id']} cleared by an erasure.", t["directive_id"], t["id"])
        held.append(t["id"])
    await conn.execute("UPDATE notices SET status = 'withdrawn', to_address = $2 WHERE to_user_id = $1 "
                       "AND status = 'queued'", person_id, token)
    await notices.rewrite_naming(conn, person_id)
    await packs.anonymise(conn, person_id, texts, token)
    after_commit.append(packs.rerender_stale)

    await db.audit(conn, user["id"], "person.erased", f"Contractor record replaced by {token}: {reason}")
    signed = [r["thread_id"] for r in await conn.fetch(
        "SELECT DISTINCT thread_id FROM signatures WHERE signer_id = $1", person_id)]
    await db.changed_threads(conn, held + signed)
    return {"person": views.person_of(await conn.fetchrow("SELECT * FROM users WHERE id = $1", person_id))}
