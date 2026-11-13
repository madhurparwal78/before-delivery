import type { PoolClient } from 'pg';
import { route, withClient, type Ctx } from './api.js';
import { HttpError, notFound } from './errors.js';
import { emitFor } from './events.js';
import { personById, holdingsByHolder } from './register.js';
import { centsString } from './vesting.js';
import { sealDocument, VaultError } from './vault.js';
import { parseStrike } from './grantJson.js';
import { divRoundHalfUp } from './decimal.js';

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

interface TenderRow {
  id: string;
  title: string;
  price_per_share: string;
  share_cap: string;
  closes_at: Date;
  state: 'open' | 'closed' | 'allocated';
}

async function tenderById(client: PoolClient, id: string): Promise<TenderRow | null> {
  const r = await client.query<TenderRow>('SELECT * FROM tenders WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

async function nextTenderId(client: PoolClient): Promise<string> {
  const r = await client.query<{ max: string | null }>(
    "SELECT max(substring(id from 5)::bigint)::text AS max FROM tenders WHERE id LIKE 'TND-%'",
  );
  return `TND-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(3, '0')}`;
}

async function nextDocumentId(client: PoolClient): Promise<string> {
  const r = await client.query<{ max: string | null }>(
    "SELECT max(substring(id from 5)::bigint)::text AS max FROM documents WHERE id LIKE 'DOC-%'",
  );
  return `DOC-${String(Number(r.rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
}

/** The allocation rule applied to the current submissions. */
export function allocationFor(cap: bigint, submissions: Array<{ shares: bigint; sequence: number }>): bigint[] {
  const total = submissions.reduce((a, s) => a + s.shares, 0n);
  if (total <= cap) return submissions.map((s) => s.shares);
  const allocs = submissions.map((s) => (s.shares * cap) / total);
  let leftover = cap - allocs.reduce((a, b) => a + b, 0n);
  const order = submissions.map((s, i) => ({ i, sequence: s.sequence })).sort((a, b) => a.sequence - b.sequence);
  for (const o of order) {
    if (leftover <= 0n) break;
    allocs[o.i]! += 1n;
    leftover -= 1n;
  }
  return allocs;
}

route('GET', '/api/tenders', ['investor', 'founder_admin'], async () => {
  return withClient(async (client) => {
    const rows = await client.query<TenderRow>('SELECT * FROM tenders ORDER BY created_at DESC');
    const tenders = [];
    for (const t of rows.rows) {
      tenders.push(await tenderJson(client, t, 'list'));
    }
    return { tenders };
  });
});

route('POST', '/api/tenders', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const fields: Record<string, string> = {};
  const title = typeof b.title === 'string' ? b.title.trim() : '';
  const price = typeof b.price_per_share === 'string' && /^\d+(\.\d+)?$/.test(b.price_per_share) ? b.price_per_share : null;
  const cap = b.share_cap;
  const closesRaw = typeof b.closes_at === 'string' ? b.closes_at : '';
  if (title.length < 1) fields.title = 'Enter a title.';
  if (price === null || price === '0' || /^0*\.0*$/.test(price) || (price.split('.')[1] ?? '').length > 4) {
    fields.price_per_share = 'Enter a price above $0.0000 with up to four decimals.';
  }
  if (typeof cap !== 'number' || !Number.isInteger(cap) || cap < 1) {
    fields.share_cap = 'Enter a whole number of shares from 1 upward.';
  }
  const closes = closesRaw ? new Date(closesRaw) : null;
  if (!closes || Number.isNaN(closes.getTime()) || closes.getTime() < Date.now() + 10_000) {
    fields.closes_at = 'Set a close time at least 10 seconds from now.';
  }
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const open = await client.query("SELECT id FROM tenders WHERE state = 'open' FOR UPDATE");
      if (open.rows.length > 0) {
        throw new HttpError(409, 'tender_already_open', 'Close the open tender before opening another.');
      }
      const id = await nextTenderId(client);
      await client.query(
        "INSERT INTO tenders (id, title, price_per_share, share_cap, closes_at, state) VALUES ($1,$2,$3,$4,$5,'open')",
        [id, title, price, cap, closes],
      );
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'tender_changed', { tender_id: id, state: 'open' });
      const investors = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'investor' AND access = 'active'");
      for (const i of investors.rows) await emitFor(client, i.id, 'tender_changed', { tender_id: id, state: 'open' });
      await client.query('COMMIT');
      const t = await tenderById(client, id);
      return t ? tenderJson(client, t, 'admin') : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

async function tenderJson(client: PoolClient, t: TenderRow, mode: 'list' | 'investor' | 'admin', personId?: string): Promise<Record<string, unknown>> {
  const at = new Date();
  const subs = await client.query<{ person_id: string; shares: string; submitted_at: Date; sequence: string }>(
    'SELECT person_id, shares, submitted_at, sequence FROM tender_submissions WHERE tender_id = $1 ORDER BY sequence',
    [t.id],
  );
  const cap = BigInt(t.share_cap);
  const totalTendered = subs.rows.reduce((a, s) => a + BigInt(s.shares), 0n);
  const remaining = cap > totalTendered ? cap - totalTendered : 0n;
  const oversub = totalTendered > cap ? totalTendered - cap : 0n;
  const allocations = allocationFor(cap, subs.rows.map((s) => ({ shares: BigInt(s.shares), sequence: Number(s.sequence) })));
  const priceDec = parseStrike(t.price_per_share);
  const result: Record<string, unknown> = {
    id: t.id,
    title: t.title,
    buyer: 'Harbourline Secondary Partners',
    price_per_share: t.price_per_share,
    share_cap: Number(t.share_cap),
    closes_at: t.closes_at.toISOString(),
    state: t.state,
    total_tendered: Number(totalTendered),
    remaining_cap: Number(remaining),
    oversubscribed_by: Number(oversub),
    server_time: at.toISOString(),
  };
  if (mode === 'admin') {
    const people = await client.query<{ id: string; name: string }>('SELECT id, name FROM people');
    const nameMap = new Map(people.rows.map((p) => [p.id, p.name]));
    result.submissions = subs.rows.map((s, i) => {
      const allocation = t.state === 'allocated' ? allocations[i]! : null;
      const proceeds = allocation ? divRoundHalfUp(allocation * priceDec.unscaled, 10n ** BigInt(priceDec.scale), 2).unscaled : null;
      return {
        holder_id: s.person_id,
        holder_name: nameMap.get(s.person_id) ?? '',
        shares: Number(s.shares),
        submitted_at: s.submitted_at.toISOString(),
        sequence: Number(s.sequence),
        allocation: allocation ? Number(allocation) : null,
        proceeds: proceeds !== null ? centsString(proceeds) : null,
      };
    });
  }
  if (mode === 'investor' && personId) {
    const nda = await client.query<{ status: string; document_id: string }>(
      `SELECT COALESCE(n.status, 'none') AS status, COALESCE(n.document_id, '') AS document_id
       FROM tender_ndas n
       LEFT JOIN documents d ON d.id = n.document_id
       WHERE n.tender_id = $1 AND n.person_id = $2`,
      [t.id, personId],
    );
    const draft = await client.query<{ shares_text: string | null }>(
      'SELECT shares_text FROM tender_drafts WHERE tender_id = $1 AND person_id = $2',
      [t.id, personId],
    );
    const mineSub = subs.rows.find((s) => s.person_id === personId);
    const idx = subs.rows.findIndex((s) => s.person_id === personId);
    const holdings = await holdingsByHolder(client);
    const issued = holdings.get(personId) ?? 0;
    const projected = t.state === 'open' && mineSub ? allocationFor(cap, subs.rows.map((s) => ({ shares: BigInt(s.shares), sequence: Number(s.sequence) })))[idx]! : null;
    const finalAlloc = t.state === 'allocated' && idx >= 0 ? allocations[idx]! : null;
    const proceeds = finalAlloc ? divRoundHalfUp(finalAlloc * priceDec.unscaled, 10n ** BigInt(priceDec.scale), 2).unscaled : null;
    result.mine = {
      nda: { status: nda.rows[0]?.status ?? 'none', document_id: nda.rows[0]?.document_id || null },
      draft_shares: draft.rows[0]?.shares_text ?? null,
      submission: mineSub
        ? { shares: Number(mineSub.shares), submitted_at: mineSub.submitted_at.toISOString(), sequence: Number(mineSub.sequence) }
        : null,
      projected_allocation: projected ? Number(projected) : null,
      allocation: finalAlloc ? Number(finalAlloc) : null,
      proceeds: proceeds !== null ? centsString(proceeds) : null,
      issued_shares: issued,
    };
  }
  return result;
}

route('GET', '/api/tenders/:id', ['investor', 'founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const t = await tenderById(client, ctx.params.id!);
    if (!t) throw notFound();
    return tenderJson(client, t, ctx.person.role === 'founder_admin' ? 'admin' : 'investor', ctx.person.id);
  });
});

route('POST', '/api/tenders/:id/nda', ['investor'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const t = await tenderById(client, ctx.params.id!);
    if (!t) throw notFound();
    const at = new Date();
    if (t.state !== 'open' || at >= t.closes_at) {
      throw new HttpError(409, 'tender_closed', 'This tender has closed.');
    }
    const existing = await client.query<{ status: string; document_id: string }>(
      `SELECT n.status, COALESCE(n.document_id, '') AS document_id
       FROM tender_ndas n LEFT JOIN documents d ON d.id = n.document_id WHERE n.tender_id = $1 AND n.person_id = $2`,
      [t.id, ctx.person.id],
    );
    if (existing.rows[0]?.status === 'sealed') {
      throw new HttpError(409, 'nda_already_signed', 'You have already signed this NDA.');
    }
    const person = await personById(client, ctx.person.id);
    const docId = existing.rows[0]?.document_id || (await nextDocumentId(client));
    const vaultKey = `tender-ndas/${t.id}/${ctx.person.id}.txt`;
    const text = [
      'Tidecraft Robotics, Inc. — Tender Offer Confidentiality Agreement',
      `Tender: ${t.id}`,
      `Seller: ${person?.name ?? ''}`,
      `Signed at: ${at.toISOString()}`,
      '',
    ].join('\n');
    let sha: string;
    try {
      sha = await sealDocument(vaultKey, Buffer.from(text, 'utf8'));
    } catch (e) {
      if (e instanceof VaultError) {
        await client.query(
          `INSERT INTO tender_ndas (tender_id, person_id, document_id, status) VALUES ($1,$2,$3,'pending')
           ON CONFLICT (tender_id, person_id) DO UPDATE SET status = 'pending'`,
          [t.id, ctx.person.id, docId],
        );
        await client.query(
          `INSERT INTO documents (id, kind, title, owner_id, tender_id, status, vault_key, version)
           VALUES ($1,'tender_nda',$2,$3,$4,'pending',$5,1) ON CONFLICT (id) DO UPDATE SET status = 'pending'`,
          [docId, `Tender NDA — ${t.title}`, ctx.person.id, t.id, vaultKey],
        );
        throw new HttpError(503, 'vault_unavailable', "The document vault can't be reached. Your NDA is pending and you can't tender yet.");
      }
      throw e;
    }
    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO tender_ndas (tender_id, person_id, document_id, status) VALUES ($1,$2,$3,'sealed')
         ON CONFLICT (tender_id, person_id) DO UPDATE SET status = 'sealed', document_id = $3`,
        [t.id, ctx.person.id, docId],
      );
      await client.query(
        `INSERT INTO documents (id, kind, title, owner_id, tender_id, status, vault_key, sha256, version)
         VALUES ($1,'tender_nda',$2,$3,$4,'sealed',$5,$6,1) ON CONFLICT (id) DO UPDATE SET status = 'sealed', sha256 = $6`,
        [docId, `Tender NDA — ${t.title}`, ctx.person.id, t.id, vaultKey, sha],
      );
      await emitFor(client, ctx.person.id, 'nda_sealed', { tender_id: t.id, document_id: docId });
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    const fresh = await tenderById(client, t.id);
    return fresh ? tenderJson(client, fresh, 'investor', ctx.person.id) : null;
  });
});

route('PUT', '/api/tenders/:id/draft', ['investor'], async (ctx: Ctx) => {
  const b = body(ctx);
  return withClient(async (client) => {
    const t = await tenderById(client, ctx.params.id!);
    if (!t) throw notFound();
    if (t.state !== 'open' || new Date() >= t.closes_at) {
      throw new HttpError(409, 'tender_closed', 'This tender has closed.');
    }
    const shares = b.shares;
    if (shares !== null && (typeof shares !== 'string' || shares.length > 12)) {
      throw new HttpError(422, 'validation', 'Some fields need attention.', { shares: 'Enter up to 12 characters.' });
    }
    await client.query(
      `INSERT INTO tender_drafts (tender_id, person_id, shares_text) VALUES ($1,$2,$3)
       ON CONFLICT (tender_id, person_id) DO UPDATE SET shares_text = $3`,
      [t.id, ctx.person.id, shares as string | null],
    );
    await emitFor(client, ctx.person.id, 'draft_saved', { kind: 'tender', tender_id: t.id });
    return tenderJson(client, t, 'investor', ctx.person.id);
  });
});

route('POST', '/api/tenders/:id/submissions', ['investor'], async (ctx: Ctx) => {
  const b = body(ctx);
  const shares = b.shares;
  if (typeof shares !== 'number' || !Number.isInteger(shares) || shares < 1) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { shares: 'Enter a whole number of shares from 1 upward.' });
  }
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const t = await tenderById(client, ctx.params.id!);
      if (!t) throw notFound();
      if (t.state !== 'open' || new Date() >= t.closes_at) {
        throw new HttpError(409, 'tender_closed', 'This tender has closed.');
      }
      const nda = await client.query<{ status: string }>(
        'SELECT status FROM tender_ndas WHERE tender_id = $1 AND person_id = $2',
        [t.id, ctx.person.id],
      );
      if (nda.rows[0]?.status !== 'sealed') {
        throw new HttpError(409, 'nda_required', 'Sign the NDA before submitting a tender.');
      }
      const existing = await client.query('SELECT person_id FROM tender_submissions WHERE tender_id = $1 AND person_id = $2', [t.id, ctx.person.id]);
      if (existing.rows.length > 0) {
        throw new HttpError(409, 'already_submitted', 'You have already submitted this tender.');
      }
      const holdings = await holdingsByHolder(client);
      const issued = holdings.get(ctx.person.id) ?? 0;
      if (shares > issued) {
        throw new HttpError(422, 'validation', 'Some fields need attention.', {
          shares: `Enter a whole number of shares from 1 to ${issued}.`,
        });
      }
      const seq = await client.query<{ next: string }>(
        'SELECT coalesce(max(sequence),0) + 1 AS next FROM tender_submissions WHERE tender_id = $1',
        [t.id],
      );
      await client.query(
        'INSERT INTO tender_submissions (tender_id, person_id, shares, sequence) VALUES ($1,$2,$3,$4)',
        [t.id, ctx.person.id, shares, Number(seq.rows[0]?.next ?? 1)],
      );
      const subs = await client.query<{ person_id: string }>('SELECT person_id FROM tender_submissions WHERE tender_id = $1', [t.id]);
      for (const s of subs.rows) {
        await emitFor(client, s.person_id, 'tender_changed', { tender_id: t.id });
      }
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'tender_changed', { tender_id: t.id });
      await client.query('COMMIT');
      const fresh = await tenderById(client, t.id);
      return { __status: 201, body: fresh ? await tenderJson(client, fresh, 'investor', ctx.person.id) : null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('DELETE', '/api/tenders/:id/submissions/mine', ['investor'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const t = await tenderById(client, ctx.params.id!);
      if (!t) throw notFound();
      if (t.state !== 'open' || new Date() >= t.closes_at) {
        throw new HttpError(409, 'tender_closed', 'This tender has closed.');
      }
      const existing = await client.query('SELECT person_id FROM tender_submissions WHERE tender_id = $1 AND person_id = $2', [t.id, ctx.person.id]);
      if (existing.rows.length === 0) {
        throw new HttpError(409, 'no_submission', 'You have not submitted this tender.');
      }
      await client.query('DELETE FROM tender_submissions WHERE tender_id = $1 AND person_id = $2', [t.id, ctx.person.id]);
      const subs = await client.query<{ person_id: string }>('SELECT person_id FROM tender_submissions WHERE tender_id = $1', [t.id]);
      for (const s of subs.rows) {
        await emitFor(client, s.person_id, 'tender_changed', { tender_id: t.id });
      }
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'tender_changed', { tender_id: t.id });
      await emitFor(client, ctx.person.id, 'tender_changed', { tender_id: t.id });
      await client.query('COMMIT');
      ctx.res.status(204).end();
      return undefined;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});
