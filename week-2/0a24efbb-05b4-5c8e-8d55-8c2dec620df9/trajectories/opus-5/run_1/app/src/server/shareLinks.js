import { createHash, randomBytes } from 'node:crypto';
import { isBusinessMonth, utcSeconds } from '../shared/businessTime.js';
import { refusals } from '../shared/copy.js';
import { appendAuditEntry } from './audit.js';
import { checkUnpublishedKeys, isMissing } from './bodyChecks.js';
import { config } from './config.js';
import { LOCKS, lock, pool, transaction } from './db.js';
import { Refusal, noSuchLink, noSuchPerson, refuse, refuseField } from './errors.js';
import { personById, personIsInMintScope } from './people.js';

export const SHARE_FIELDS = ['person_id', 'month'];

function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function monthDiscriminator(personId, month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return personId * 100000 + (year % 1000) * 100 + monthNumber;
}

/** The one liveness rule. A link is dead the moment any of these holds. */
export function linkIsDead(link, minter, person, now = Date.now()) {
  if (link.revoked_at || link.replaced_at) return true;
  if (now >= link.expires_at.getTime()) return true;
  return !personIsInMintScope(minter, person);
}

export function shareLinkObject(link, token) {
  return {
    id: link.id,
    token,
    person_id: link.person_id,
    month: link.month,
    expires_at: utcSeconds(link.expires_at),
  };
}

async function mintThrottle(callerId) {
  const windowMs = config.shareLinkMintWindowMinutes * 60 * 1000;
  const since = new Date(Date.now() - windowMs);
  const result = await pool.query(
    'SELECT minted_at FROM share_link WHERE minted_by = $1 AND minted_at >= $2 ORDER BY minted_at ASC',
    [callerId, since],
  );
  if (result.rows.length < config.shareLinkMints) return null;
  const oldest = result.rows[0].minted_at.getTime();
  const secondsLeft = Math.max(1, Math.ceil((oldest + windowMs - Date.now()) / 1000));
  return secondsLeft;
}

/** Mints a read-only month link, replacing any link that was live for the same month. */
export async function mintShareLink(caller, body) {
  if (caller.role !== 'manager' && caller.role !== 'admin') refuse(403, refusals.shareRole);

  const retryAfter = await mintThrottle(caller.id);
  if (retryAfter !== null) throw new Refusal(429, refusals.shareThrottled, { retryAfter });

  checkUnpublishedKeys(body, SHARE_FIELDS);
  if (isMissing(body, 'person_id')) refuseField(400, refusals.missingField('person_id'), 'person_id');
  if (!Number.isInteger(body.person_id) || body.person_id < 1) refuseField(400, refusals.personIdValue, 'person_id');
  if (isMissing(body, 'month')) refuseField(400, refusals.missingField('month'), 'month');
  if (!isBusinessMonth(body.month)) refuseField(400, refusals.monthFormat, 'month');

  const person = await personById(body.person_id);
  if (!personIsInMintScope(caller, person)) throw noSuchPerson();

  const token = randomBytes(32).toString('base64url');
  return transaction(async (client) => {
    await lock(client, LOCKS.shareMint, monthDiscriminator(person.id, body.month));
    const now = new Date();
    await client.query(
      `UPDATE share_link SET replaced_at = $3
        WHERE person_id = $1 AND month = $2 AND revoked_at IS NULL AND replaced_at IS NULL`,
      [person.id, body.month, now],
    );
    const inserted = await client.query(
      `INSERT INTO share_link (person_id, month, token_hash, minted_by, minted_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, person_id, month, expires_at`,
      [person.id, body.month, tokenHash(token), caller.id, now, new Date(now.getTime() + config.shareLinkTtlSeconds * 1000)],
    );
    const link = inserted.rows[0];
    await appendAuditEntry(client, {
      request_id: null,
      actor_id: caller.id,
      actor_role: caller.role,
      verb: 'share_mint',
      subject_type: 'share_link',
      subject_id: link.id,
      occurred_at: now,
      note: `Month ${link.month} for ${person.name}.`,
    });
    return shareLinkObject(link, token);
  });
}

export async function revokeShareLink(caller, id, body) {
  if (caller.role !== 'manager' && caller.role !== 'admin') refuse(403, refusals.shareRole);

  return transaction(async (client) => {
    const found =
      id === null
        ? { rows: [] }
        : await client.query(
            'SELECT id, person_id, month, minted_by, minted_at, expires_at, revoked_at, replaced_at FROM share_link WHERE id = $1 FOR UPDATE',
            [id],
          );
    const link = found.rows[0];
    if (!link) throw noSuchLink();

    const person = await personById(link.person_id, client);
    if (!personIsInMintScope(caller, person)) throw noSuchLink();

    const minter = await personById(link.minted_by, client);
    if (linkIsDead(link, minter, person)) refuse(409, refusals.shareLinkDead);

    checkUnpublishedKeys(body, []);

    const now = new Date();
    await client.query('UPDATE share_link SET revoked_at = $2 WHERE id = $1', [link.id, now]);
    await appendAuditEntry(client, {
      request_id: null,
      actor_id: caller.id,
      actor_role: caller.role,
      verb: 'share_revoke',
      subject_type: 'share_link',
      subject_id: link.id,
      occurred_at: now,
      note: `Month ${link.month} for ${person.name}.`,
    });
  });
}

/** Reads a shared link by its token. No session is needed and none is read. */
export async function shareLinkByToken(token) {
  const result = await pool.query(
    'SELECT id, person_id, month, minted_by, minted_at, expires_at, revoked_at, replaced_at FROM share_link WHERE token_hash = $1',
    [tokenHash(String(token))],
  );
  const link = result.rows[0];
  if (!link) return { status: 404 };
  const person = await personById(link.person_id);
  const minter = await personById(link.minted_by);
  if (linkIsDead(link, minter, person)) return { status: 410 };
  return { status: 200, link, person };
}
