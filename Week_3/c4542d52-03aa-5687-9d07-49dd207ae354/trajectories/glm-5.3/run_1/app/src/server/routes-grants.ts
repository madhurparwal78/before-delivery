import type { PoolClient } from 'pg';
import { route, withClient, type Ctx } from './api.js';
import { loadConfig } from './config.js';
import { HttpError, notFound } from './errors.js';
import { serverDate } from './time.js';
import { emitFor } from './events.js';
import { writeLedgerEntry } from './ledger.js';
import { serializeGrant } from './grantJson.js';
import { sealDocument, VaultError } from './vault.js';
import {
  personById, poolFigures, type GrantRow,
} from './register.js';
import { addMonthsClamped } from './time.js';
import { readGrant } from './grantReader.js';
import { dateStr } from './pgtypes.js';

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

interface ValuationRow {
  id: string;
  effective_on: string;
  expires_on: string;
  fmv_per_share: string;
  firm: string;
  recorded_at: Date;
}

/** The current valuation: latest effective_on on or before the server date; ties to the later recorded. */
export async function currentValuation(client: PoolClient, at: Date): Promise<ValuationRow | null> {
  const dateStr = serverDate(at);
  const r = await client.query<ValuationRow>(
    `SELECT * FROM valuations WHERE effective_on <= $1
     ORDER BY effective_on DESC, recorded_at DESC, id DESC LIMIT 1`,
    [dateStr],
  );
  return r.rows[0] ?? null;
}

export async function assertValuationCurrent(client: PoolClient, at: Date): Promise<ValuationRow> {
  const v = await currentValuation(client, at);
  if (!v || v.expires_on < serverDate(at)) {
    throw new HttpError(409, 'valuation_lapsed', 'The current valuation lapsed. Record a new valuation before issuing grants.');
  }
  return v;
}

function nextGrantId(client: PoolClient): Promise<string> {
  return (async () => {
    const r = await client.query<{ max: string | null }>(
      "SELECT max(substring(id from 8)::bigint)::text AS max FROM grants WHERE id LIKE 'TC-OPT-%'",
    );
    return `TC-OPT-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(4, '0')}`;
  })();
}

async function nextDocumentId(client: PoolClient): Promise<string> {
  const r = await client.query<{ max: string | null }>(
    "SELECT max(substring(id from 5)::bigint)::text AS max FROM documents WHERE id LIKE 'DOC-%'",
  );
  return `DOC-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
}

export async function grantById(client: PoolClient, id: string): Promise<GrantRow | null> {
  return readGrant(client, id);
}

/** Visibility: the holder or the founder admin. */
export async function visibleGrant(client: PoolClient, person: { id: string; role: string }, id: string): Promise<GrantRow> {
  const g = await grantById(client, id);
  if (!g) throw notFound();
  if (person.role !== 'founder_admin' && g.holder_id !== person.id) throw notFound();
  return g;
}

function parsePositiveInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) return null;
  return v;
}

function parsePrice(v: unknown, maxScale: number): string | null {
  if (typeof v !== 'string') return null;
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  const frac = v.split('.')[1] ?? '';
  if (frac.length > maxScale) return null;
  if (/^0*(\.0+)?$/.test(v)) return null;
  return v;
}

function parseDateStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toISOString().slice(0, 10) !== v) return null;
  return v;
}

route('GET', '/api/grants', ['founder_admin', 'option_holder', 'leaver'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const at = new Date();
    const rows = ctx.person.role === 'founder_admin'
      ? await client.query('SELECT id FROM grants ORDER BY id')
      : await client.query('SELECT id FROM grants WHERE holder_id = $1 ORDER BY id', [ctx.person.id]);
    const grants = [];
    for (const r of rows.rows as Array<{ id: string }>) {
      const g = await grantById(client, r.id);
      if (g) grants.push(await serializeGrant(client, g, at));
    }
    return { grants };
  });
});

route('POST', '/api/grants', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  await validateGrantDraftFields(b, new Date());
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await assertValuationCurrent(client, new Date());
      const id = await nextGrantId(client);
      await client.query(
        `INSERT INTO grants (id, holder_id, options, strike, vesting_type, vesting_start, state, draft_version)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',1)`,
        [id, b.holder_id, b.options, b.strike, b.vesting_type, b.vesting_start],
      );
      const g = await grantById(client, id);
      await client.query('COMMIT');
      return g ? serializeGrant(client, g, new Date()) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

async function validateGrantDraftFields(b: Record<string, unknown>, at: Date): Promise<void> {
  const fields: Record<string, string> = {};
  const poolFig = await withClient((c) => poolFigures(c));
  const current = await withClient((c) => currentValuation(c, at));

  const holderId = typeof b.holder_id === 'string' ? b.holder_id : undefined;
  if (holderId === undefined || holderId === '') {
    fields.holder_id = 'Choose an option holder.';
  } else {
    const p = await withClient((c) => personById(c, holderId));
    if (!p) throw notFound();
    if (p.role !== 'option_holder') fields.holder_id = 'Choose an option holder.';
  }

  const options = b.options;
  if (parsePositiveInt(options) === null) {
    fields.options = `Enter a whole number of options from 1 to ${Math.max(0, poolFig.available)}.`;
  }

  const strike = parsePrice(b.strike, 4);
  if (strike === null) {
    fields.strike = current
      ? `Strike must be at least the current fair market value of $${current.fmv_per_share}.`
      : 'Strike must be a price above $0.0000 with up to four decimals.';
  } else if (current && strikeCompare(strike, current.fmv_per_share) < 0) {
    fields.strike = `Strike must be at least the current fair market value of $${current.fmv_per_share}.`;
  }

  const vtype = b.vesting_type;
  if (vtype !== 'standard' && vtype !== 'monthly') {
    fields.vesting_type = 'Choose a vesting type.';
  }

  const vstart = parseDateStr(b.vesting_start);
  if (vstart === null) {
    fields.vesting_start = 'Enter the vesting start as YYYY-MM-DD.';
  } else {
    const dateStr = serverDate(at);
    const min = '2015-01-01';
    const oneYear = addMonthsClamped(dateStr, 12);
    if (vstart < min || vstart > oneYear) {
      fields.vesting_start = 'Enter the vesting start as YYYY-MM-DD.';
    }
  }

  if (Object.keys(fields).length > 0) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
  }
}

function strikeCompare(a: string, b: string): number {
  const [aw, af = ''] = a.split('.');
  const [bw, bf = ''] = b.split('.');
  const A = BigInt(aw + af.padEnd(4, '0'));
  const B = BigInt(bw + bf.padEnd(4, '0'));
  return A < B ? -1 : A > B ? 1 : 0;
}

route('GET', '/api/grants/:id', ['founder_admin', 'option_holder', 'leaver'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const g = await visibleGrant(client, ctx.person, ctx.params.id!);
    return serializeGrant(client, g, new Date());
  });
});

route('PATCH', '/api/grants/:id', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const g = await grantById(client, ctx.params.id!);
      if (!g) throw notFound();
      if (g.state !== 'draft') {
        throw new HttpError(409, 'grant_not_draft', 'This grant is not a draft.');
      }
      // draft_version semantics
      if ('draft_version' in b) {
        const dv = b.draft_version;
        if (typeof dv !== 'number' || !Number.isInteger(dv) || dv < 1) {
          throw new HttpError(422, 'validation', 'Some fields need attention.', {
            draft_version: 'The draft version must be a positive whole number.',
          });
        }
        if (dv !== g.draft_version) {
          const latest = await grantById(client, g.id);
          throw new HttpError(409, 'draft_outdated', 'This draft changed in another tab. The latest version is shown.', undefined, {
            grant: latest ? await serializeGrant(client, latest, new Date()) : null,
          });
        }
      }
      const merged = {
        holder_id: ('holder_id' in b ? b.holder_id : g.holder_id) as string,
        options: 'options' in b ? b.options : g.options,
        strike: ('strike' in b ? b.strike : g.strike) as string,
        vesting_type: ('vesting_type' in b ? b.vesting_type : g.vesting_type) as string,
        vesting_start: ('vesting_start' in b ? b.vesting_start : g.vesting_start) as string,
      };
      await validateGrantDraftFields(merged, new Date());
      await client.query(
        'UPDATE grants SET holder_id=$1, options=$2, strike=$3, vesting_type=$4, vesting_start=$5, draft_version = draft_version + 1 WHERE id=$6',
        [merged.holder_id, merged.options, merged.strike, merged.vesting_type, merged.vesting_start, g.id],
      );
      const updated = await grantById(client, g.id);
      await client.query('COMMIT');
      return updated ? serializeGrant(client, updated, new Date()) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('DELETE', '/api/grants/:id', ['founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const g = await grantById(client, ctx.params.id!);
      if (!g) throw notFound();
      if (g.state !== 'draft') throw new HttpError(409, 'grant_not_draft', 'This grant is not a draft.');
      await client.query('DELETE FROM grants WHERE id = $1', [g.id]);
      await client.query('COMMIT');
      ctx.res.status(204).end();
      return undefined;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('POST', '/api/grants/:id/submit', ['founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const at = new Date();
      const g = await grantById(client, ctx.params.id!);
      if (!g) throw notFound();
      if (g.state !== 'draft') throw new HttpError(409, 'grant_not_draft', 'This grant is not a draft.');
      await assertValuationCurrent(client, at);
      const fields: Record<string, string> = {};
      const poolFig = await poolFigures(client);
      const current = await currentValuation(client, at);
      const holder = await personById(client, g.holder_id);
      if (!holder || holder.role !== 'option_holder') fields.holder_id = 'Choose an option holder.';
      if (g.options < 1) fields.options = `Enter a whole number of options from 1 to ${Math.max(0, poolFig.available)}.`;
      if (g.options > poolFig.available) {
        throw new HttpError(409, 'pool_exhausted', `Only ${poolFig.available} options are available in the pool.`);
      }
      if (!current || strikeCompare(g.strike, current.fmv_per_share) < 0) {
        fields.strike = `Strike must be at least the current fair market value of $${current?.fmv_per_share ?? '0.0000'}.`;
      }
      const vstart = parseDateStr(g.vesting_start);
      if (!vstart) fields.vesting_start = 'Enter the vesting start as YYYY-MM-DD.';
      if (g.vesting_type !== 'standard' && g.vesting_type !== 'monthly') fields.vesting_type = 'Choose a vesting type.';
      if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation', 'Some fields need attention.', fields);

      await client.query("UPDATE grants SET state = 'board_queue' WHERE id = $1", [g.id]);
      await client.query('DELETE FROM grant_votes WHERE grant_id = $1', [g.id]);
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state: 'board_queue' });
      const board = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'board_member' AND access = 'active'");
      for (const b of board.rows) await emitFor(client, b.id, 'grant_state', { grant_id: g.id, state: 'board_queue' });
      await client.query('COMMIT');
      const updated = await grantById(client, g.id);
      return updated ? serializeGrant(client, updated, at) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('GET', '/api/board/queue', ['board_member', 'founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const size = Number((await client.query<{ count: string }>("SELECT count(*)::text FROM people WHERE role = 'board_member'")).rows[0]?.count ?? 0);
    const quorum = Math.floor(size / 2) + 1;
    const rows = await client.query<GrantRow & { options: string }>(
      "SELECT * FROM grants WHERE state = 'board_queue' ORDER BY id",
    );
    const grants = [];
    for (const g of rows.rows) {
      const votes = await client.query<{ voter_id: string; vote: string }>(
        'SELECT voter_id, vote FROM grant_votes WHERE grant_id = $1',
        [g.id],
      );
      grants.push({
        id: g.id,
        holder_name: g.holder_name,
        options: Number(g.options),
        strike: g.strike,
        vesting_type: g.vesting_type,
        vesting_start: g.vesting_start ?? '',
        approvals: votes.rows.filter((v) => v.vote === 'approve').length,
        declines: votes.rows.filter((v) => v.vote === 'decline').length,
        my_vote: votes.rows.find((v) => v.voter_id === ctx.person.id)?.vote ?? null,
      });
    }
    return { quorum, board_size: size, grants };
  });
});

route('POST', '/api/board/queue/:id/votes', ['board_member'], async (ctx: Ctx) => {
  const b = body(ctx);
  const vote = b.vote;
  if (vote !== 'approve' && vote !== 'decline') {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { vote: 'Choose approve or decline.' });
  }
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Serialize votes on one grant: queue state check under lock.
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [ctx.params.id!]);
      void lock;
      const g = await grantById(client, ctx.params.id!);
      if (!g || g.state !== 'board_queue') {
        throw new HttpError(409, 'grant_not_in_queue', 'This grant is not waiting for a vote.');
      }
      const existing = await client.query('SELECT vote FROM grant_votes WHERE grant_id = $1 AND voter_id = $2', [g.id, ctx.person.id]);
      if (existing.rows.length > 0) {
        throw new HttpError(409, 'already_voted', `You have already voted on ${g.id}.`);
      }
      await client.query('INSERT INTO grant_votes (grant_id, voter_id, vote) VALUES ($1,$2,$3)', [g.id, ctx.person.id, vote]);
      const votes = await client.query<{ vote: string }>('SELECT vote FROM grant_votes WHERE grant_id = $1', [g.id]);
      const approvals = votes.rows.filter((v) => v.vote === 'approve').length;
      const declines = votes.rows.filter((v) => v.vote === 'decline').length;
      const size = Number((await client.query<{ count: string }>("SELECT count(*)::text FROM people WHERE role = 'board_member'")).rows[0]?.count ?? 0);
      const quorum = Math.floor(size / 2) + 1;
      let state: 'board_queue' | 'approved' | 'draft' = 'board_queue';
      if (approvals >= quorum) {
        state = 'approved';
        await client.query("UPDATE grants SET state = 'approved' WHERE id = $1", [g.id]);
      } else if (declines >= quorum) {
        state = 'draft';
        await client.query("UPDATE grants SET state = 'draft' WHERE id = $1", [g.id]);
        await client.query('DELETE FROM grant_votes WHERE grant_id = $1', [g.id]);
      }
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state });
      const board = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'board_member' AND access = 'active'");
      for (const bm of board.rows) await emitFor(client, bm.id, 'grant_state', { grant_id: g.id, state });
      await emitFor(client, g.holder_id, 'grant_state', { grant_id: g.id, state });
      await client.query('COMMIT');
      const updated = await grantById(client, g.id);
      void updated;
      return {
        id: g.id,
        holder_name: g.holder_name,
        options: g.options,
        strike: g.strike,
        vesting_type: g.vesting_type,
        vesting_start: g.vesting_start,
        approvals,
        declines,
        my_vote: vote,
        state,
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('POST', '/api/grants/:id/offer', ['founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const at = new Date();
      const cfg = loadConfig();
      const g = await grantById(client, ctx.params.id!);
      if (!g) throw notFound();
      if (g.state !== 'approved') throw new HttpError(409, 'grant_not_approved', 'This grant is not approved by the board.');
      await assertValuationCurrent(client, at);
      const current = await currentValuation(client, at);
      if (current && strikeCompare(g.strike, current.fmv_per_share) < 0) {
        throw new HttpError(409, 'strike_below_fmv', `Strike must be at least the current fair market value of $${current.fmv_per_share}.`);
      }
      const offeredAt = at;
      const expiresAt = new Date(offeredAt.getTime() + cfg.offerWindowSeconds * 1000);
      await client.query(
        "UPDATE grants SET state = 'offered', offered_at = $1, offer_expires_at = $2 WHERE id = $3",
        [offeredAt, expiresAt, g.id],
      );
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state: 'offered' });
      await emitFor(client, g.holder_id, 'grant_state', { grant_id: g.id, state: 'offered', options: g.options });
      await client.query('COMMIT');
      const updated = await grantById(client, g.id);
      return updated ? serializeGrant(client, updated, at) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('POST', '/api/grants/:id/accept', ['option_holder', 'leaver'], async (ctx: Ctx) => {
  const at = new Date();
  // Reserve the document and its text outside the transaction, so a vault
  // outage leaves a pending signature that a later retry seals.
  const prep = await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`accept:${ctx.params.id}`]);
      void lock;
      const g = await grantById(client, ctx.params.id!);
      if (!g) throw notFound();
      if (g.holder_id !== ctx.person.id) throw notFound();
      if (g.offer_expires_at && at >= g.offer_expires_at) {
        await expireGrantLocked(client, g.id);
        throw new HttpError(409, 'offer_expired', `The offer for grant ${g.id} has expired.`);
      }
      if (g.state !== 'offered') {
        throw new HttpError(409, 'grant_not_offered', `The offer for grant ${g.id} is not open.`);
      }
      const holder = await personById(client, g.holder_id);
      const docId = g.agreement_document_id ?? (await nextDocumentId(client));
      const text = [
        'Tidecraft Robotics, Inc. — Stock Option Grant Agreement',
        `Grant: ${g.id}`,
        `Holder: ${holder?.name ?? ''}`,
        `Options: ${g.options}`,
        `Strike price: $${g.strike}`,
        `Vesting: ${g.vesting_type === 'standard' ? '4 years, 1-year cliff' : '4 years monthly, no cliff'}, from ${g.vesting_start}`,
        `Signed by: ${holder?.name ?? ''}`,
        `Signed at: ${at.toISOString()}`,
        '',
      ].join('\n');
      await client.query(
        `INSERT INTO documents (id, kind, title, owner_id, grant_id, status, vault_key, version)
         VALUES ($1,'grant_agreement',$2,$3,$4,'pending',$5,1) ON CONFLICT (id) DO NOTHING`,
        [docId, `Stock Option Grant Agreement — ${g.id}`, g.holder_id, g.id, `grant-agreements/${g.id}.txt`],
      );
      await client.query('UPDATE grants SET agreement_document_id = $1 WHERE id = $2', [docId, g.id]);
      await client.query('COMMIT');
      return { grant: g, holderName: holder?.name ?? '', docId, text };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });

  // The signature counts only when the vault stores the bytes and reads them back.
  let sha: string;
  try {
    sha = await sealDocument(`grant-agreements/${prep.grant.id}.txt`, Buffer.from(prep.text, 'utf8'));
  } catch (e) {
    if (e instanceof VaultError) {
      await withClient((c) =>
        emitFor(c, prep.grant.holder_id, 'grant_signature_pending', { grant_id: prep.grant.id, document_id: prep.docId }));
      throw new HttpError(
        503, 'vault_unavailable',
        `The document vault can't be reached. Your signature is pending and grant ${prep.grant.id} is not yet accepted.`,
      );
    }
    throw e;
  }

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`accept:${prep.grant.id}`]);
      void lock;
      const g = await grantById(client, prep.grant.id);
      if (!g || g.state !== 'offered' || g.holder_id !== ctx.person.id) {
        throw new HttpError(409, 'grant_not_offered', `The offer for grant ${prep.grant.id} is not open.`);
      }
      if (g.offer_expires_at && at >= g.offer_expires_at) {
        await expireGrantLocked(client, g.id);
        throw new HttpError(409, 'offer_expired', `The offer for grant ${g.id} has expired.`);
      }
      await client.query('UPDATE documents SET status = $1, sha256 = $2 WHERE id = $3', ['sealed', sha, prep.docId]);
      await client.query(
        "UPDATE grants SET state = 'accepted', accepted_at = $1, agreement_document_id = $2 WHERE id = $3",
        [at, prep.docId, g.id],
      );
      await writeLedgerEntry(client, {
        holder_id: g.holder_id, holder_name: prep.holderName, kind: 'grant_accepted', class: 'Options',
        shares_delta: 0, options_delta: g.options, reference: g.id,
      });
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state: 'accepted' });
      await emitFor(client, g.holder_id, 'grant_state', { grant_id: g.id, state: 'accepted', document_id: prep.docId });
      await client.query('COMMIT');
      const updated = await grantById(client, g.id);
      return updated ? serializeGrant(client, updated, at) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

async function expireGrantLocked(client: PoolClient, grantId: string): Promise<void> {
  const g = await grantById(client, grantId);
  if (!g || g.state !== 'offered') return;
  await client.query("UPDATE grants SET state = 'expired' WHERE id = $1", [grantId]);
  const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
  for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: grantId, state: 'expired' });
  await emitFor(client, g.holder_id, 'grant_state', { grant_id: grantId, state: 'expired' });
}

route('POST', '/api/grants/:id/decline', ['option_holder', 'leaver'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const lock = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`accept:${ctx.params.id}`]);
      void lock;
      const at = new Date();
      const g = await grantById(client, ctx.params.id!);
      if (!g) throw notFound();
      if (g.holder_id !== ctx.person.id) throw notFound();
      if (g.offer_expires_at && at >= g.offer_expires_at) {
        await expireGrantLocked(client, g.id);
        throw new HttpError(409, 'offer_expired', `The offer for grant ${g.id} has expired.`);
      }
      if (g.state !== 'offered') throw new HttpError(409, 'grant_not_offered', `The offer for grant ${g.id} is not open.`);
      await client.query("UPDATE grants SET state = 'board_queue' WHERE id = $1", [g.id]);
      await client.query('DELETE FROM grant_votes WHERE grant_id = $1', [g.id]);
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state: 'board_queue' });
      const board = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'board_member' AND access = 'active'");
      for (const bm of board.rows) await emitFor(client, bm.id, 'grant_state', { grant_id: g.id, state: 'board_queue' });
      await emitFor(client, g.holder_id, 'grant_state', { grant_id: g.id, state: 'board_queue' });
      await client.query('COMMIT');
      const updated = await grantById(client, g.id);
      return updated ? serializeGrant(client, updated, at) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('GET', '/api/valuations', ['founder_admin'], async () => {
  return withClient(async (client) => {
    const at = new Date();
    const rows = await client.query<ValuationRow>('SELECT * FROM valuations ORDER BY effective_on DESC, recorded_at DESC, id DESC');
    const current = await currentValuation(client, at);
    const today = serverDate(at);
    const valuations = rows.rows.map((v) => ({
      id: v.id,
      effective_on: dateStr(v.effective_on)!,
      expires_on: dateStr(v.expires_on)!,
      fmv_per_share: v.fmv_per_share,
      firm: v.firm,
      status: v.id === current?.id ? (v.expires_on >= today ? 'current' : 'lapsed') : (v.expires_on < today ? 'lapsed' : 'superseded'),
    }));
    const currentRow = valuations.find((v) => v.id === current?.id && v.status === 'current');
    return { valuations, current_id: currentRow?.id ?? null };
  });
});

route('POST', '/api/valuations', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const fields: Record<string, string> = {};
  const effective = parseDateStr(b.effective_on);
  const expires = parseDateStr(b.expires_on);
  const fmv = parsePrice(b.fmv_per_share, 4);
  const firm = typeof b.firm === 'string' ? b.firm.trim() : '';
  const dateStr = serverDate(new Date());
  if (!effective || effective > dateStr) fields.effective_on = "The effective date can't be after today.";
  if (!expires || (effective && expires < effective)) fields.expires_on = "The expiry date can't be before the effective date.";
  if (fmv === null) fields.fmv_per_share = 'Enter a value above $0.0000 with up to four decimals.';
  if (firm.length < 1) fields.firm = 'Enter the valuation firm.';
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const r = await client.query<{ max: string | null }>(
        "SELECT max(substring(id from 5)::bigint)::text AS max FROM valuations WHERE id LIKE 'VAL-%'",
      );
      const id = `VAL-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(2, '0')}`;
      await client.query(
        'INSERT INTO valuations (id, effective_on, expires_on, fmv_per_share, firm) VALUES ($1,$2,$3,$4,$5)',
        [id, effective, expires, fmv, firm],
      );
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'valuation_changed', { valuation_id: id });
      await client.query('COMMIT');
      const at = new Date();
      return {
        id,
        effective_on: effective,
        expires_on: expires,
        fmv_per_share: fmv,
        firm,
        status: expires !== null && expires >= serverDate(at) ? 'current' : 'lapsed',
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});
