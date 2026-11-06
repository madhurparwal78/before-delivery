import crypto from 'node:crypto';
import { query, withTransaction } from '../db/pg.js';
import { ApiError, errors } from '../domain/errors.js';
import { formatTimestamp, isValidMonth } from '../domain/time.js';
import { csvLine } from '../domain/csv.js';
import { entryHash } from '../domain/audit.js';
import { currentPolicy, mintScope, isLinkDead } from './rules.js';
import { TYPE_CODES } from '../db/seed.js';
import { calendarScope, calendarCounts } from './calendar.js';
import { hashToken } from './sessions.js';
import { config } from './config.js';

const JSON_TYPE = 'application/json; charset=utf-8';
export { JSON_TYPE };

function json(reply, status, body) {
  reply.header('content-type', JSON_TYPE);
  reply.status(status);
  reply.send(body);
}

async function policyWithNames(p) {
  const creator = await query('SELECT name FROM person WHERE id = $1', [p.created_by]);
  return {
    version: p.version,
    monthly_cap: p.monthly_cap,
    lookback_days: p.lookback_days,
    enabled_types: TYPE_CODES.filter((t) => p.enabled_types.includes(t)),
    require_note_on_approve: p.require_note_on_approve,
    self_approval_allowed: false,
    created_by: creator[0]?.name ?? null,
    created_at: formatTimestamp(p.created_at),
  };
}

export async function handleGetPolicy(request, reply) {
  const p = await currentPolicy();
  reply.header('ETag', `"${p.version}"`);
  return json(reply, 200, await policyWithNames(p));
}

export async function handlePutPolicy(viewer, request, reply) {
  if (viewer.role !== 'admin') {
    throw new ApiError(403, 'Only people operations changes the policy.');
  }
  const ifMatch = request.headers['if-match'];
  if (ifMatch === undefined || ifMatch === null || ifMatch === '') {
    throw new ApiError(428, 'Send If-Match with the policy version you are changing.');
  }
  const current = await currentPolicy();
  if (ifMatch !== `"${current.version}"`) {
    reply.header('ETag', `"${current.version}"`);
    throw new ApiError(412, `Version ${current.version} was saved after the one you are changing. Reload to see it.`);
  }

  const body = request.body ?? {};
  const published = ['monthly_cap', 'lookback_days', 'enabled_types', 'require_note_on_approve', 'self_approval_allowed'];
  for (const key of Object.keys(body)) {
    if (!published.includes(key)) throw errors.unpublishedKey(key);
  }

  // field checks, one field at a time: first whether it is missing, then its value
  const fieldChecks = {
    monthly_cap(v) {
      if (!Number.isInteger(v) || v < 0 || v > 10) {
        throw new ApiError(400, 'monthly_cap must be a whole number from 0 to 10.', { field: 'monthly_cap' });
      }
    },
    lookback_days(v) {
      if (!Number.isInteger(v) || v < 1 || v > 90) {
        throw new ApiError(400, 'lookback_days must be a whole number from 1 to 90.', { field: 'lookback_days' });
      }
    },
    enabled_types(v) {
      if (!Array.isArray(v)) {
        throw new ApiError(400, 'enabled_types must list correction types, each once.', { field: 'enabled_types' });
      }
      const seen = new Set();
      for (const t of v) {
        if (!TYPE_CODES.includes(t) || seen.has(t)) {
          throw new ApiError(400, 'enabled_types must list correction types, each once.', { field: 'enabled_types' });
        }
        seen.add(t);
      }
      if (v.length === 0) {
        throw new ApiError(400, 'At least one correction type must stay available.', { field: 'enabled_types' });
      }
    },
    require_note_on_approve(v) {
      if (v !== true && v !== false) {
        throw new ApiError(400, 'require_note_on_approve must be true or false.', { field: 'require_note_on_approve' });
      }
    },
  };
  const values = {};
  for (const field of ['monthly_cap', 'lookback_days', 'enabled_types', 'require_note_on_approve']) {
    const v = body[field];
    if (v === undefined || v === null) {
      throw new ApiError(400, `${field} is required.`, { field });
    }
    fieldChecks[field](v);
    values[field] = v;
  }
  if (body.self_approval_allowed !== undefined && body.self_approval_allowed !== false) {
    throw new ApiError(400, 'Not available. Self approval is refused by this product.', { field: 'self_approval_allowed' });
  }

  const newVersion = await withTransaction(async (client) => {
    // one winner: serialise savers, then re-check the version in force
    await client.query('LOCK TABLE policy IN ACCESS EXCLUSIVE MODE');
    const cur = await client.query('SELECT version FROM policy ORDER BY version DESC LIMIT 1');
    if (cur.rows[0].version !== current.version) return null;
    const next = cur.rows[0].version + 1;
    await client.query(
      `INSERT INTO policy (version, employer_id, monthly_cap, lookback_days, enabled_types, require_note_on_approve, self_approval_allowed, created_by, created_at)
       VALUES ($1, 1, $2, $3, $4, $5, false, $6, now())`,
      [next, values.monthly_cap, values.lookback_days, values.enabled_types,
        values.require_note_on_approve, viewer.id]
    );
    // audit append inside the same transaction
    const last = await client.query('SELECT seq, entry_hash FROM audit_event ORDER BY seq DESC LIMIT 1');
    const prevHash = last.rowCount > 0 ? last.rows[0].entry_hash : '0'.repeat(64);
    const seq = last.rowCount > 0 ? Number(last.rows[0].seq) + 1 : 1;
    const now = new Date();
    now.setMilliseconds(0);
    const shape = {
      seq, at: formatTimestamp(now), actor_id: viewer.id, action: 'policy_saved',
      subject_type: 'policy', subject_id: next, detail: `Version ${next}.`, prev_hash: prevHash,
    };
    await client.query(
      `INSERT INTO audit_event (seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note, prev_hash, entry_hash)
       VALUES ($1,null,$2,'admin','policy_saved','policy',$3,$4,$5,$6,$7)`,
      [seq, viewer.id, next, now, `Version ${next}.`, prevHash, entryHash(shape)]
    );
    return next;
  });

  if (newVersion === null) {
    const cur = await currentPolicy();
    reply.header('ETag', `"${cur.version}"`);
    throw new ApiError(412, `Version ${cur.version} was saved after the one you are changing. Reload to see it.`);
  }
  const saved = await currentPolicy();
  reply.header('ETag', `"${saved.version}"`);
  return json(reply, 201, await policyWithNames(saved));
}

export async function handlePolicyHistory(viewer, request, reply) {
  if (viewer.role !== 'admin') {
    throw new ApiError(403, 'Only people operations reads the policy history.');
  }
  const rows = await query('SELECT * FROM policy ORDER BY version DESC');
  const versions = [];
  for (const p of rows) versions.push(await policyWithNames(p));
  const cur = rows[0];
  reply.header('ETag', `"${cur.version}"`);
  return json(reply, 200, { versions });
}

export async function handleAudit(viewer, request, reply) {
  if (viewer.role !== 'admin') {
    throw new ApiError(403, 'Only people operations reads the whole trail.');
  }
  const rows = await query(
    `SELECT a.*, p.name AS actor_name FROM audit_event a
     JOIN person p ON p.id = a.actor_id
     ORDER BY a.seq DESC`
  );
  const entries = rows.map((a) => ({
    id: a.id,
    seq: Number(a.seq),
    request_id: a.request_id ?? null,
    actor: a.actor_name,
    actor_role: a.actor_role,
    verb: a.verb,
    subject_type: a.subject_type,
    subject_id: Number(a.subject_id),
    occurred_at: formatTimestamp(a.occurred_at),
    note: a.note ?? null,
    prev_hash: a.prev_hash,
    entry_hash: a.entry_hash,
  }));
  return json(reply, 200, { entries });
}

export async function handleTrailCsv(viewer, request, reply) {
  if (viewer.role !== 'admin') {
    throw new ApiError(403, 'Only people operations exports the trail.');
  }
  const rows = await query(
    `SELECT a.*, p.name AS actor_name FROM audit_event a
     JOIN person p ON p.id = a.actor_id
     ORDER BY a.seq ASC`
  );
  const reasons = new Map();
  const reqIds = rows.filter((r) => r.request_id).map((r) => r.request_id);
  if (reqIds.length > 0) {
    const reasonRows = await query(
      'SELECT id, reason FROM regularisation_request WHERE id = ANY($1)', [reqIds]
    );
    for (const r of reasonRows) reasons.set(r.id, r.reason);
  }
  let out = csvLine([
    'seq', 'at', 'actor', 'actor_role', 'action', 'subject_type', 'subject_id',
    'reason', 'detail', 'prev_hash', 'entry_hash',
  ]);
  for (const a of rows) {
    out += csvLine([
      String(a.seq),
      formatTimestamp(a.occurred_at),
      a.actor_name,
      a.actor_role,
      a.verb,
      a.subject_type,
      String(a.subject_id),
      a.request_id ? (reasons.get(a.request_id) ?? '') : '',
      a.note ?? '',
      a.prev_hash,
      a.entry_hash,
    ]);
  }
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', 'attachment; filename="trail.csv"');
  reply.status(200);
  reply.send(out);
}

export async function handleTrailVerify(viewer, request, reply) {
  if (viewer.role !== 'admin') {
    throw new ApiError(403, 'Only people operations reads the whole trail.');
  }
  const rows = await query(
    `SELECT a.*, p.id AS actor_person_id FROM audit_event a
     JOIN person p ON p.id = a.actor_id
     ORDER BY a.seq ASC`
  );
  const entries = rows.length;
  let prev = '0'.repeat(64);
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    const shape = {
      seq: Number(a.seq),
      at: formatTimestamp(a.occurred_at),
      actor_id: a.actor_person_id,
      action: a.verb,
      subject_type: a.subject_type,
      subject_id: Number(a.subject_id),
      detail: a.note ?? null,
      prev_hash: a.prev_hash,
    };
    const recomputed = entryHash(shape);
    if (a.prev_hash !== prev || recomputed !== a.entry_hash) {
      return json(reply, 200, { intact: false, entries, first_broken_seq: Number(a.seq) });
    }
    prev = a.entry_hash;
  }
  const checkedThrough = rows.length > 0 ? Number(rows[rows.length - 1].seq) : 0;
  return json(reply, 200, { intact: true, entries, checked_through: checkedThrough });
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export async function handleCalendar(viewer, request, reply) {
  if (viewer.role !== 'manager' && viewer.role !== 'admin') {
    throw new ApiError(403, 'Only managers and people operations read the calendar.');
  }
  const params = request.queryParams || new URLSearchParams(request.url.split('?')[1] || '');
  let month = params.get('month') || '';
  if (month === '') {
    const seeded = await query('SELECT seeded_on FROM employer WHERE id = 1');
    month = seeded[0].seeded_on.toISOString().slice(0, 10).slice(0, 7);
  } else if (!isValidMonth(month)) {
    throw new ApiError(400, 'month must read YYYY-MM.', { field: 'month' });
  }
  const personParam = params.get('person') || '';
  if (personParam.includes('\u0000')) {
    throw new ApiError(400, 'person cannot contain a NUL character.', { field: 'person' });
  }
  const scopePeople = await calendarScope(viewer);
  const days = await calendarCounts(month, scopePeople, personParam || null);
  return json(reply, 200, {
    month,
    days,
    people: scopePeople.map((p) => ({ name: p.name, work_address: p.work_address })),
  });
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

export async function handleMintShareLink(viewer, request, reply) {
  if (viewer.role === 'employee') {
    throw new ApiError(403, 'Only managers and people operations share a month.');
  }
  // mint throttle
  const windowStart = new Date(Date.now() - config.shareLinkMintWindowMinutes * 60 * 1000);
  const recent = await query(
    `SELECT minted_at FROM share_link WHERE minted_by = $1 AND minted_at >= $2
     ORDER BY minted_at DESC`,
    [viewer.id, windowStart]
  );
  if (recent.length >= config.shareLinkMints) {
    const oldest = recent[recent.length - 1].minted_at;
    const retryAfter = Math.max(1, Math.ceil(
      (oldest.getTime() + config.shareLinkMintWindowMinutes * 60000 - Date.now()) / 1000));
    reply.header('Retry-After', String(retryAfter));
    throw new ApiError(429, 'Too many shared links for now. Try again later.');
  }

  const body = request.body ?? {};
  for (const key of Object.keys(body)) {
    if (key !== 'person_id' && key !== 'month') throw errors.unpublishedKey(key);
  }
  if (body.person_id === undefined || body.person_id === null) {
    throw new ApiError(400, 'person_id is required.', { field: 'person_id' });
  }
  if (!Number.isInteger(body.person_id) || body.person_id < 1) {
    throw new ApiError(400, 'person_id must be a person id.', { field: 'person_id' });
  }
  if (body.month === undefined || body.month === null) {
    throw new ApiError(400, 'month is required.', { field: 'month' });
  }
  if (!isValidMonth(body.month)) {
    throw new ApiError(400, 'month must read YYYY-MM.', { field: 'month' });
  }

  const scope = await mintScope(null, viewer);
  const person = scope.find((p) => p.id === body.person_id);
  if (!person) throw errors.noSuchPerson();

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.shareLinkTtlSeconds * 1000);

  // the store itself guarantees one live link per person and month: a mint
  // that races with another re-runs, marking the winner's link replaced
  const linkId = await mintWithRetry(person, body, tokenHash, viewer, expiresAt);

  return json(reply, 201, {
    id: Number(linkId),
    token,
    person_id: person.id,
    month: body.month,
    expires_at: formatTimestamp(expiresAt),
  });
}

export async function handleRevokeShareLink(viewer, id, request, reply) {
  if (viewer.role === 'employee') {
    throw new ApiError(403, 'Only managers and people operations share a month.');
  }
  const body = request.body ?? {};
  for (const key of Object.keys(body)) throw errors.unpublishedKey(key);
  const rows = await query('SELECT * FROM share_link WHERE id = $1', [id]);
  const link = rows[0];
  if (!link) throw errors.noSuchLink();
  const scope = await mintScope(null, viewer);
  if (!scope.find((p) => p.id === link.person_id)) throw errors.noSuchLink();
  const dead = await isLinkDead(null, link);
  if (dead) throw new ApiError(409, 'That link no longer works.');

  await withTransaction(async (client) => {
    const res = await client.query(
      `UPDATE share_link SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL AND replaced_at IS NULL`,
      [id]
    );
    if (res.rowCount === 0) throw new ApiError(409, 'That link no longer works.');
    const last = await client.query('SELECT seq, entry_hash FROM audit_event ORDER BY seq DESC LIMIT 1');
    const prevHash = last.rowCount > 0 ? last.rows[0].entry_hash : '0'.repeat(64);
    const seq = last.rowCount > 0 ? Number(last.rows[0].seq) + 1 : 1;
    const now = new Date();
    now.setMilliseconds(0);
    const personRows = await client.query('SELECT name FROM person WHERE id = $1', [link.person_id]);
    const note = `Month ${link.month} for ${personRows.rows[0].name}.`;
    const shape = {
      seq, at: formatTimestamp(now), actor_id: viewer.id, action: 'share_revoke',
      subject_type: 'share_link', subject_id: id, detail: note, prev_hash: prevHash,
    };
    await client.query(
      `INSERT INTO audit_event (seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note, prev_hash, entry_hash)
       VALUES ($1,null,$2,$3,'share_revoke','share_link',$4,$5,$6,$7,$8)`,
      [seq, viewer.id, viewer.role, id, now, note, prevHash, entryHash(shape)]
    );
  });
  reply.status(204);
  reply.send();
}

/** Mint one link, retrying when a concurrent mint won the live-slot race. */
async function mintWithRetry(person, body, tokenHash, viewer, expiresAt) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(async (client) => {
        // end any live link for the same person and month
        await client.query(
          `UPDATE share_link SET replaced_at = now()
           WHERE person_id = $1 AND month = $2
             AND revoked_at IS NULL AND replaced_at IS NULL`,
          [person.id, body.month]
        );
        const res = await client.query(
          `INSERT INTO share_link (person_id, month, token_hash, minted_by, minted_at, expires_at)
           VALUES ($1,$2,$3,$4,now(),$5) RETURNING id`,
          [person.id, body.month, tokenHash, viewer.id, expiresAt]
        );
        const last = await client.query('SELECT seq, entry_hash FROM audit_event ORDER BY seq DESC LIMIT 1');
        const prevHash = last.rowCount > 0 ? last.rows[0].entry_hash : '0'.repeat(64);
        const seq = last.rowCount > 0 ? Number(last.rows[0].seq) + 1 : 1;
        const now = new Date();
        now.setMilliseconds(0);
        const note = `Month ${body.month} for ${person.name}.`;
        const shape = {
          seq, at: formatTimestamp(now), actor_id: viewer.id, action: 'share_mint',
          subject_type: 'share_link', subject_id: Number(res.rows[0].id), detail: note, prev_hash: prevHash,
        };
        await client.query(
          `INSERT INTO audit_event (seq, request_id, actor_id, actor_role, verb, subject_type, subject_id, occurred_at, note, prev_hash, entry_hash)
           VALUES ($1,null,$2,$3,'share_mint','share_link',$4,$5,$6,$7,$8)`,
          [seq, viewer.id, viewer.role, res.rows[0].id, now, note, prevHash, entryHash(shape)]
        );
        return res.rows[0].id;
      });
    } catch (err) {
      // the loser of a simultaneous mint re-runs and replaces the winner
      if (err && err.code === '23505' && attempt < 3) continue;
      throw err;
    }
  }
}

/** Read a shared month by token. Returns null for unknown, 'dead' for dead links. */
export async function readShareMonth(token) {
  const rows = await query('SELECT * FROM share_link WHERE token_hash = $1', [hashToken(token)]);
  const link = rows[0];
  if (!link) return { kind: 'unknown' };
  const dead = await isLinkDead(null, link);
  if (dead) return { kind: 'dead' };
  const personRows = await query('SELECT name FROM person WHERE id = $1', [link.person_id]);
  const days = await calendarCounts(link.month, [{ id: link.person_id, name: personRows[0].name, work_address: 'x' }], null);
  return {
    kind: 'live',
    name: personRows[0].name,
    month: link.month,
    days,
  };
}
