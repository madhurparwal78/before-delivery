import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.mjs";
import { one, tx } from "./db.mjs";
import { WORDING, hasNul, nulRefusal, onlyPublished, refuse, required } from "./http.mjs";
import { RealmUnavailable, exchangePassword } from "./realm.mjs";
import { fold, foldedColumn } from "./text.mjs";

export const SESSION_COOKIE = "rostara_session";
const LOCK_AFTER = 5;
const REFUSED = "Those details do not match an account";

const hash = (token) => createHash("sha256").update(token).digest("hex");

/** The token a request presents: the bearer header first, then the session cookie. */
export function presentedToken(headers) {
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(headers.authorization ?? ""))?.[1];
  if (bearer) return bearer;
  for (const part of String(headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE && value.length) return decodeURIComponent(value.join("="));
  }
  return null;
}

/**
 * Resolve a presented token. Answers `{caller}` for a live session (renewing its last use), `{ended: true}` for one
 * past its idle or absolute limit, replaced by a later sign-in or whose person is inactive, and `{}` for no session at
 * all (signed out included). The caller's role, manager and active flag are read from the person row on every call.
 */
export async function resolveSession(token) {
  if (!token) return {};
  const found = await one(
    `WITH found AS (
       SELECT s.id, p.active, s.replaced_at IS NULL
                AND now() - s.last_used_at < make_interval(secs => $2) AND now() - s.began_at < make_interval(secs => $3) AS fresh
         FROM desk_session s JOIN person p ON p.id = s.person_id
        WHERE s.token_hash = $1 AND (s.ended_at IS NULL OR s.replaced_at IS NOT NULL)),
     renewed AS (
       UPDATE desk_session s SET last_used_at = now() FROM found
        WHERE s.id = found.id AND found.fresh AND found.active
       RETURNING s.person_id)
     SELECT found.fresh AND found.active AS live, p.id, p.name, p.work_address, p.role, p.manager_id
       FROM found LEFT JOIN renewed ON true LEFT JOIN person p ON p.id = renewed.person_id`,
    [hash(token), config.sessionIdleSeconds, config.sessionMaxSeconds],
  );
  if (!found) return {};
  if (!found.live) return { ended: true };
  const { id, name, work_address: workAddress, role, manager_id: managerId } = found;
  return { caller: { id, name, workAddress, role, managerId } };
}

/** The caller of an API call, or the 401 for no session and for an ended one. */
export async function requireCaller(token) {
  const { caller, ended } = await resolveSession(token);
  if (caller) return caller;
  throw refuse(401, ended ? WORDING.ended : WORDING.signedOut);
}

export async function endSession(token) {
  await one("UPDATE desk_session SET ended_at = now() WHERE token_hash = $1 AND ended_at IS NULL", [hash(token)]);
}

async function lockedFor(address) {
  const lock = await one(
    "SELECT ceil(extract(epoch FROM locked_until - now()))::int AS left FROM sign_in_lock WHERE work_address = $1 AND locked_until > now()",
    [address],
  );
  return lock?.left ?? 0;
}

/** Record one attempt; the refusal that brings the count to five locks the address. Runs one address at a time. */
async function recordAttempt(address, succeeded) {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rostara.sign_in'), hashtext($1))", [address]);
    await client.query("INSERT INTO sign_in_attempt (work_address, attempted_at, succeeded) VALUES ($1, now(), $2)",
      [address, succeeded]);
    if (succeeded) return;
    const { refused } = await one(
      `SELECT count(*)::int AS refused FROM sign_in_attempt
        WHERE work_address = $1 AND NOT succeeded
          AND attempted_at > greatest(
            coalesce((SELECT max(attempted_at) FROM sign_in_attempt WHERE work_address = $1 AND succeeded), '-infinity'),
            coalesce((SELECT locked_until FROM sign_in_lock WHERE work_address = $1), '-infinity'),
            now() - make_interval(secs => $2))`,
      [address, config.signInWindowSeconds], client);
    if (refused >= LOCK_AFTER) {
      await client.query(
        `INSERT INTO sign_in_lock (work_address, locked_until) VALUES ($1, now() + make_interval(secs => $2))
         ON CONFLICT (work_address) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
        [address, config.signInLockoutSeconds]);
    }
  });
}

/**
 * `POST /api/session`: the sign-in steps in the published order. Answers the new session's token and person. A
 * session the request presented ends at once, replaced by the new one; the desk always chooses the new identifier.
 */
export async function signIn(body, presented) {
  if (!body) throw required("work_address");
  onlyPublished(body, ["work_address", "password"]);
  for (const field of ["work_address", "password"]) {
    if (hasNul(body[field])) throw nulRefusal(field);
    if (typeof body[field] !== "string" || body[field] === "") throw required(field);
  }
  const address = fold(body.work_address);
  const left = await lockedFor(address);
  if (left > 0) {
    await recordAttempt(address, false);
    throw refuse(429, "Too many attempts for this address. Try again later.", {}, {
      "retry-after": String(Math.min(Math.max(left, 1), config.signInLockoutSeconds)),
    });
  }
  let identity;
  try {
    identity = await exchangePassword(address, body.password);
  } catch (error) {
    if (error instanceof RealmUnavailable) throw refuse(503, "Sign-in is unavailable right now. Try again shortly.");
    throw error;
  }
  const person = identity && await one(
    `SELECT id, name, work_address, role FROM person WHERE ${foldedColumn("work_address")} = $1 AND active`,
    [fold(identity.email)],
  );
  await recordAttempt(address, Boolean(person));
  if (!person) throw refuse(401, REFUSED);
  await one("UPDATE person SET subject = $2 WHERE id = $1 AND subject IS DISTINCT FROM $2", [person.id, identity.subject]);
  const token = randomBytes(32).toString("base64url");
  await tx(async (client) => {
    if (presented) {
      await client.query(
        "UPDATE desk_session SET ended_at = now(), replaced_at = now() WHERE token_hash = $1 AND ended_at IS NULL",
        [hash(presented)]);
    }
    await client.query(
      "INSERT INTO desk_session (token_hash, person_id, began_at, last_used_at) VALUES ($1, $2, now(), now())",
      [hash(token), person.id]);
  });
  return { token, person: { name: person.name, work_address: person.work_address }, role: person.role };
}
