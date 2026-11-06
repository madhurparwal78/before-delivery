import { createHash, randomBytes } from "node:crypto";
import { appendAudit } from "./audit.mjs";
import { monthCounts } from "./calendar.mjs";
import { config } from "./config.mjs";
import { one, tx } from "./db.mjs";
import {
  fieldRefusal, hasNul, isMissing, nulRefusal, onlyPublished, pathId, refuse, required,
} from "./http.mjs";
import { inMintScope } from "./scope.mjs";
import { isRealMonth, stamp } from "./time.mjs";

// Shared month links: minted for one person's month, read without a session, read-only, and live only while
// unexpired, unrevoked, unreplaced and still inside the minter's current mint scope.

const NOT_A_MINTER = "Only managers and people operations share a month.";
const hash = (token) => createHash("sha256").update(token).digest("hex");

/** Shared-link liveness over `l` (the link), `p` (its person) and `m` (its minter), decided here and nowhere else. */
const LIVE = `(l.revoked_at IS NULL AND l.replaced_at IS NULL AND now() < l.expires_at AND ${inMintScope("m", "p")})`;
const LINK = `share_link l JOIN person p ON p.id = l.person_id JOIN person m ON m.id = l.minted_by`;

function mayMint(caller) {
  if (caller.role === "employee") throw refuse(403, NOT_A_MINTER);
}

/** The mint throttle: at most `SHARE_LINK_MINTS` mints per minter within the window, counted in postgres. */
async function throttle(client, caller) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('rostara.share_mint'), $1)", [caller.id]);
  const { used, wait } = await one(
    `SELECT count(*)::int AS used,
            ceil(extract(epoch FROM min(minted_at) + make_interval(mins => $2) - now()))::int AS wait
       FROM share_link WHERE minted_by = $1 AND minted_at > now() - make_interval(mins => $2)`,
    [caller.id, config.shareLinkMintWindowMinutes], client);
  if (used >= config.shareLinkMints) {
    throw refuse(429, "Too many shared links for now. Try again later.", {}, { "retry-after": String(Math.max(wait, 1)) });
  }
}

function checkMintFields(body) {
  onlyPublished(body, ["person_id", "month"]);
  if (hasNul(body.person_id)) throw nulRefusal("person_id");
  if (isMissing(body, "person_id")) throw required("person_id");
  if (!Number.isSafeInteger(body.person_id) || body.person_id < 1) {
    throw fieldRefusal(400, "person_id", "person_id must be a person id.");
  }
  if (hasNul(body.month)) throw nulRefusal("month");
  if (isMissing(body, "month")) throw required("month");
  if (!isRealMonth(body.month)) throw fieldRefusal(400, "month", "month must read YYYY-MM.");
  return { personId: body.person_id, month: body.month };
}

/** `POST /api/share-links`: replaces any live link for the same person and month, in one transaction with its entry. */
export async function mintShareLink(caller, body) {
  mayMint(caller);
  return tx(async (client) => {
    await throttle(client, caller);
    const { personId, month } = checkMintFields(body);
    const person = await one(
      `SELECT p.id, p.name FROM person p JOIN person m ON m.id = $2 WHERE p.id = $1::bigint AND ${inMintScope("m", "p")}`,
      [personId, caller.id], client);
    if (!person) throw refuse(404, "No such person.");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rostara.share'), hashtext($1))", [`${person.id}:${month}`]);
    await client.query(
      "UPDATE share_link SET replaced_at = now() WHERE person_id = $1 AND month = $2 AND revoked_at IS NULL AND replaced_at IS NULL",
      [person.id, month]);
    const token = randomBytes(32).toString("base64url");
    const link = await one(
      `INSERT INTO share_link (person_id, month, token_hash, minted_by, minted_at, expires_at)
       SELECT $1, $2, $3, $4, at, at + make_interval(secs => $5) FROM (SELECT date_trunc('second', now()) AS at) t
       RETURNING id, expires_at`,
      [person.id, month, hash(token), caller.id, config.shareLinkTtlSeconds], client);
    await appendAudit(client, {
      actorId: caller.id, actorRole: caller.role, verb: "share_mint", subjectType: "share_link", subjectId: link.id,
      note: `Month ${month} for ${person.name}.`,
    });
    return { id: Number(link.id), token, person_id: person.id, month, expires_at: stamp(link.expires_at) };
  });
}

/** `DELETE /api/share-links/<id>`: ends a live link inside the caller's mint scope, with its entry. */
export async function revokeShareLink(caller, segment, body) {
  mayMint(caller);
  await tx(async (client) => {
    const id = pathId(segment);
    const link = id && await one(
      `SELECT l.id, l.month, p.name, ${LIVE} AS live FROM ${LINK} JOIN person c ON c.id = $2
        WHERE l.id = $1 AND ${inMintScope("c", "p")} FOR UPDATE OF l`, [id, caller.id], client);
    if (!link) throw refuse(404, "No such link.");
    if (!link.live) throw refuse(409, "That link no longer works.");
    onlyPublished(body ?? {}, []);
    await client.query("UPDATE share_link SET revoked_at = now() WHERE id = $1", [link.id]);
    await appendAudit(client, {
      actorId: caller.id, actorRole: caller.role, verb: "share_revoke", subjectType: "share_link", subjectId: link.id,
      note: `Month ${link.month} for ${link.name}.`,
    });
  });
}

/** `GET /share/<token>`: `{status: 404}` for no such link, `{status: 410}` for a dead one, or the month's counts. */
export async function sharedMonth(token) {
  const link = await one(`SELECT l.month, p.id, p.name, ${LIVE} AS live FROM ${LINK} WHERE l.token_hash = $1`, [hash(token)]);
  if (!link) return { status: 404 };
  if (!link.live) return { status: 410 };
  return { status: 200, name: link.name, month: link.month, days: await monthCounts([link.id], link.month) };
}
