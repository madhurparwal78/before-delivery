import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { route, withClient, personJson, type Ctx } from './api.js';
import { HttpError, notFound } from './errors.js';
import { emitFor } from './events.js';
import { writeLedgerEntry } from './ledger.js';
import { personById } from './register.js';
import { latestVestedMark, centsString } from './vesting.js';
import { closePersonSockets } from './liveSockets.js';
import { readGrants } from './grantReader.js';
import { readDocument, sealDocument, VaultError } from './vault.js';
import { serverDate } from './time.js';
import { loadConfig } from './config.js';
import { divCeil, divRoundHalfUp, divRoundDown } from './decimal.js';

function body(ctx: Ctx): Record<string, unknown> {
  return (ctx.body ?? {}) as Record<string, unknown>;
}

interface DocRow {
  id: string;
  kind: 'grant_agreement' | 'exercise_notice' | 'tender_nda';
  title: string;
  owner_id: string;
  grant_id: string | null;
  order_id: string | null;
  tender_id: string | null;
  status: 'pending' | 'sealed';
  sha256: string | null;
  vault_key: string;
  created_at: Date;
  version: string;
  supersedes: string | null;
  superseded_by: string | null;
}

async function docById(client: PoolClient, id: string): Promise<DocRow | null> {
  const r = await client.query<DocRow>('SELECT * FROM documents WHERE id = $1', [id]);
  return r.rows[0] ?? null;
}

function docJson(d: DocRow): Record<string, unknown> {
  return {
    id: d.id,
    kind: d.kind,
    title: d.title,
    owner_id: d.owner_id,
    status: d.status,
    sha256: d.sha256,
    vault_key: d.vault_key,
    created_at: d.created_at.toISOString(),
    version: Number(d.version),
    supersedes: d.supersedes,
    superseded_by: d.superseded_by,
  };
}

route('GET', '/api/documents', ['founder_admin', 'option_holder', 'leaver', 'investor'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const rows = ctx.person.role === 'founder_admin'
      ? await client.query('SELECT * FROM documents ORDER BY created_at DESC, id DESC')
      : await client.query('SELECT * FROM documents WHERE owner_id = $1 ORDER BY created_at DESC, id DESC', [ctx.person.id]);
    return { documents: rows.rows.map((d) => docJson(d as unknown as DocRow)) };
  });
});

route('GET', '/api/documents/:id', ['founder_admin', 'option_holder', 'leaver', 'investor'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    const d = await docById(client, ctx.params.id!);
    if (!d) throw notFound();
    if (ctx.person.role !== 'founder_admin' && d.owner_id !== ctx.person.id) throw notFound();
    return docJson(d);
  });
});

route('GET', '/api/documents/:id/content', ['founder_admin', 'option_holder', 'leaver', 'investor'], async (ctx: Ctx) => {
  const d = await withClient((c) => docById(c, ctx.params.id!));
  if (!d) throw notFound();
  if (ctx.person.role !== 'founder_admin' && d.owner_id !== ctx.person.id) throw notFound();
  if (d.status !== 'sealed') throw new HttpError(409, 'document_pending', 'This document is not sealed yet.');
  let bytes: Buffer;
  try {
    bytes = await readDocument(d.vault_key);
  } catch (e) {
    if (e instanceof VaultError) {
      throw new HttpError(503, 'vault_unavailable', "The document vault can't be reached. Try again shortly.");
    }
    throw e;
  }
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  ctx.res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  ctx.res.setHeader('X-Document-SHA256', sha);
  ctx.res.status(200);
  ctx.res.end(bytes);
  return undefined;
});

route('POST', '/api/documents/:id/corrections', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const text = typeof b.text === 'string' ? b.text : '';
  if (text.length < 1 || text.length > 20_000) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { text: 'Enter a document text of 1 to 20,000 characters.' });
  }
  return withClient(async (client) => {
    const original = await docById(client, ctx.params.id!);
    if (!original) throw notFound();
    if (original.kind === 'tender_nda') {
      throw new HttpError(409, 'document_not_correctable', 'A tender NDA cannot be corrected.');
    }
    const latest = await client.query<DocRow>(
      'SELECT * FROM documents WHERE superseded_by IS NULL AND (grant_id = $1 OR order_id = $2) AND kind = $3 ORDER BY version DESC LIMIT 1',
      [original.grant_id, original.order_id, original.kind],
    );
    const latestDoc = latest.rows[0] ?? original;
    if (latestDoc.id !== original.id) {
      throw new HttpError(409, 'document_superseded', 'Only the latest version can be corrected.');
    }
    if (original.status !== 'sealed') {
      throw new HttpError(409, 'document_pending', 'This document is not sealed yet.');
    }
    const version = Number(original.version) + 1;
    const baseKey = original.vault_key.replace(/\.txt$/, '');
    const vaultKey = `${baseKey}.v${version}.txt`;
    let sha: string;
    try {
      sha = await sealDocument(vaultKey, Buffer.from(text, 'utf8'));
    } catch (e) {
      if (e instanceof VaultError) {
        throw new HttpError(503, 'vault_unavailable', "The document vault can't be reached. Try again shortly.");
      }
      throw e;
    }
    await client.query('BEGIN');
    try {
      const next = await client.query<{ max: string | null }>(
        "SELECT max(substring(id from 5)::bigint)::text AS max FROM documents WHERE id LIKE 'DOC-%'",
      );
      const newId = `DOC-${String(Number(next.rows[0]?.max ?? 0) + 1).padStart(6, '0')}`;
      await client.query(
        `INSERT INTO documents (id, kind, title, owner_id, grant_id, order_id, tender_id, status, sha256, vault_key, version, supersedes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'sealed',$8,$9,$10,$11)`,
        [newId, original.kind, original.title, original.owner_id, original.grant_id, original.order_id, original.tender_id, sha, vaultKey, version, original.id],
      );
      await client.query('UPDATE documents SET superseded_by = $1 WHERE id = $2', [newId, original.id]);
      await emitFor(client, original.owner_id, 'document_corrected', { document_id: newId, supersedes: original.id });
      await client.query('COMMIT');
      const fresh = await docById(client, newId);
      return { __status: 201, body: fresh ? docJson(fresh) : null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

// ---------- people management ----------

route('PATCH', '/api/people/:id', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const role = typeof b.role === 'string' ? b.role : '';
  if (!['option_holder', 'investor', 'board_member'].includes(role)) {
    throw new HttpError(422, 'validation', 'Some fields need attention.', { role: 'Choose a role.' });
  }
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const p = await personById(client, ctx.params.id!);
      if (!p) throw notFound();
      if (p.id === ctx.person.id) {
        throw new HttpError(409, 'own_role', 'You cannot change your own role.');
      }
      if (p.role === 'leaver') {
        throw new HttpError(409, 'person_is_leaver', 'This person is a leaver and their role cannot change.');
      }
      await client.query('UPDATE people SET role = $1 WHERE id = $2', [role, p.id]);
      await emitFor(client, p.id, 'role_changed', { role });
      await client.query('COMMIT');
      const fresh = await personById(client, p.id);
      return { person: fresh ? personJson(fresh) : null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('POST', '/api/people/:id/remove-access', ['founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const p = await personById(client, ctx.params.id!);
      if (!p) throw notFound();
      if (p.id === ctx.person.id) throw new HttpError(409, 'own_role', 'You cannot remove your own access.');
      if (p.access === 'removed') {
        throw new HttpError(409, 'access_already_removed', 'Access was already removed for this person.');
      }
      await emitFor(client, p.id, 'access_removed', {});
      await closePersonSockets(p.id);
      await client.query("UPDATE people SET access = 'removed' WHERE id = $1", [p.id]);
      await client.query('DELETE FROM sessions WHERE person_id = $1', [p.id]);
      await client.query('COMMIT');
      const fresh = await personById(client, p.id);
      return { person: fresh ? personJson(fresh) : null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

route('POST', '/api/people/:id/departure', ['founder_admin'], async (ctx: Ctx) => {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const p = await personById(client, ctx.params.id!);
      if (!p) throw notFound();
      if (p.role !== 'option_holder') {
        throw new HttpError(409, 'not_an_option_holder', 'Only an option holder can have a departure recorded.');
      }
      const at = new Date();
      const cfg = loadConfig();
      const dateStr = serverDate(at);
      const windowEnds = new Date(at.getTime() + cfg.leaverWindowSeconds * 1000);
      await client.query(
        "UPDATE people SET role = 'leaver', terminated_at = $1, termination_date = $2, window_ends_at = $3 WHERE id = $4",
        [at, dateStr, windowEnds, p.id],
      );
      // Forfeit every unvested option across their accepted grants.
      const grants = await readGrants(client, "g.holder_id = $1 AND g.state = 'accepted'", [p.id]);
      for (const g of grants) {
        const inputs = { options: Number(g.options), vestingType: g.vesting_type, vestingStart: String(g.vesting_start) };
        const mark = latestVestedMark(inputs, dateStr);
        const vested = mark < 0 ? 0 : Math.floor((Number(g.options) * mark) / 48);
        const forfeited = Number(g.options) - vested;
        if (forfeited > 0) {
          await client.query('UPDATE grants SET forfeited = $1 WHERE id = $2', [forfeited, g.id]);
          await writeLedgerEntry(client, {
            holder_id: p.id, holder_name: p.name, kind: 'options_cancelled', class: 'Options',
            shares_delta: 0, options_delta: -forfeited, reference: g.id,
          });
        }
      }
      // Expire any offered grant at once.
      const offered = await client.query("SELECT id, holder_id FROM grants WHERE holder_id = $1 AND state = 'offered'", [p.id]);
      for (const g of offered.rows as Array<{ id: string; holder_id: string }>) {
        await client.query("UPDATE grants SET state = 'expired' WHERE id = $1", [g.id]);
        const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
        for (const a of admins.rows) await emitFor(client, a.id, 'grant_state', { grant_id: g.id, state: 'expired' });
        await emitFor(client, g.holder_id, 'grant_state', { grant_id: g.id, state: 'expired' });
      }
      await emitFor(client, p.id, 'departure_recorded', { window_ends_at: windowEnds.toISOString() });
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'cap_table_changed', {});
      await client.query('COMMIT');
      const fresh = await personById(client, p.id);
      return { person: fresh ? personJson(fresh) : null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

// ---------- round scenario ----------

route('POST', '/api/scenarios/round', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const fields: Record<string, string> = {};
  const pre = typeof b.pre_money === 'string' && /^\d+(\.\d+)?$/.test(b.pre_money) && !/^0*(\.0+)?$/.test(b.pre_money) && (b.pre_money.split('.')[1] ?? '').length <= 2 ? b.pre_money : null;
  const investment = typeof b.investment === 'string' && /^\d+(\.\d+)?$/.test(b.investment) && !/^0*(\.0+)?$/.test(b.investment) && (b.investment.split('.')[1] ?? '').length <= 2 ? b.investment : null;
  const poolPct = typeof b.target_pool_percent === 'string' && /^\d+(\.\d+)?$/.test(b.target_pool_percent) ? b.target_pool_percent : null;
  if (pre === null) fields.pre_money = 'Enter an amount above $0.00 with up to two decimals.';
  if (investment === null) fields.investment = 'Enter an amount above $0.00 with up to two decimals.';
  let pct: bigint | null = null;
  if (poolPct === null || (poolPct.split('.')[1] ?? '').length > 2) {
    fields.target_pool_percent = 'Enter a percentage from 0.00 to 30.00.';
  } else {
    const [w, f = ''] = poolPct.split('.');
    pct = BigInt(w + f.padEnd(2, '0'));
    if (pct < 0n || pct > 3000n) fields.target_pool_percent = 'Enter a percentage from 0.00 to 30.00.';
  }
  return withClient(async (client) => {
    const at = new Date();
    const current = await currentValuationRef(client, at);
    if (Object.keys(fields).length > 0) {
      if (fields.target_pool_percent === 'Enter a percentage from 0.00 to 30.00.') {
        void fields;
      }
      throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
    }
    const F = BigInt(await fullyDilutedRef(client));
    const pool = await poolFiguresRef(client);
    const U = BigInt(pool.unallocated);
    const preCents = toCents(pre!);
    const invCents = toCents(investment!);
    // k = p/100 * (pre + inv) / pre, all exact in scaled integers.
    const kNum = pct! * (preCents + invCents);   // scale: 10^2 (pct) * cents
    const kDen = 10_000n * preCents;            // 100 * 100 (pct->ratio) * pre
    // k >= 1  <=>  kNum >= kDen
    if (kNum >= kDen) {
      throw new HttpError(422, 'validation', 'Some fields need attention.', {
        target_pool_percent: "This target pool can't be reached at this investment.",
      });
    }
    // T = max(0, ceil((k*F - U) / (1 - k)))
    // k*F = kNum * F / kDen. Use rational arithmetic:
    const kFNum = kNum * F;
    const kFDen = kDen;
    // (kF - U) / (1 - k) = (kFNum/kFDen - U) / (1 - kNum/kDen)
    // = (kFNum - U*kFDen) / (kFDen - kNum) ... careful: (kF - U)/(1-k)
    const numer = kFNum - U * kFDen;
    const denom = kFDen - kNum;
    const T = numer > 0n ? divCeil(numer, denom) : 0n;
    // Price per share = pre / (F + T), rounded down to $0.0001.
    const priceUnscaled = divRoundDown(preCents * 10_000n, (F + T) * 100n, 0).unscaled; // price in 1/10000 dollars
    // N = floor(investment / price)
    const N = (invCents * 10_000n) / (priceUnscaled * 100n);
    const post = F + T + N;
    // Percentages at two decimals, half-up: percent = part/post*100.
    const pctOf = (part: bigint): string => {
      const hundredths = divRoundHalfUp(part * 10_000n, post, 0).unscaled;
      return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, '0')}`;
    };
    const newInvestor = pctOf(N);
    const poolAfter = pctOf(U + T);
    const dilution = pctOf(T + N);
    const used = divRoundHalfUp(N * priceUnscaled, 100n, 0).unscaled;
    const fmv = current && current.expires_on >= serverDate(at) ? current.fmv_per_share : null;
    const fmvUnscaled = fmv !== null ? BigInt(Math.round(Number(fmv) * 10_000)) : null;
    const priceToFmv = fmvUnscaled !== null && fmvUnscaled > 0n
      ? divRoundHalfUp(priceUnscaled * 100n, fmvUnscaled * 100n, 2)
      : null;
    return {
      fully_diluted_before: Number(F),
      unallocated_pool_before: Number(U),
      pool_top_up: Number(T),
      price_per_share: `${(priceUnscaled / 10_000n).toString()}.${(priceUnscaled % 10_000n).toString().padStart(4, '0')}`,
      new_shares: Number(N),
      fully_diluted_after: Number(post),
      new_investor_percent: newInvestor,
      pool_after_percent: poolAfter,
      dilution_percent: dilution,
      investment_used: centsString(used),
      fmv_per_share: fmv,
      price_to_fmv: priceToFmv !== null ? `${(priceToFmv.unscaled / 100n).toString()}.${(priceToFmv.unscaled % 100n).toString().padStart(2, '0')}` : null,
    };
  });
});

function toCents(s: string): bigint {
  const [w, f = ''] = s.split('.');
  return BigInt(w + f.padEnd(2, '0'));
}

route('GET', '/api/scenarios/saved', ['founder_admin'], async () => {
  return withClient(async (client) => {
    const rows = await client.query('SELECT * FROM saved_scenarios ORDER BY saved_at DESC, id DESC');
    return {
      scenarios: rows.rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name,
        pre_money: r.pre_money,
        investment: r.investment,
        target_pool_percent: r.target_pool_percent,
        saved_at: new Date(r.saved_at as string).toISOString(),
      })),
    };
  });
});

route('POST', '/api/scenarios/saved', ['founder_admin'], async (ctx: Ctx) => {
  const b = body(ctx);
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const fields: Record<string, string> = {};
  if (name.length < 1 || name.length > 60) fields.name = 'Enter a name of 1 to 60 characters.';
  const pre = typeof b.pre_money === 'string' ? b.pre_money : '';
  const investment = typeof b.investment === 'string' ? b.investment : '';
  const poolPct = typeof b.target_pool_percent === 'string' ? b.target_pool_percent : '';
  if (!/^\d+(\.\d{1,2})?$/.test(pre)) fields.pre_money = 'Enter an amount above $0.00 with up to two decimals.';
  if (!/^\d+(\.\d{1,2})?$/.test(investment)) fields.investment = 'Enter an amount above $0.00 with up to two decimals.';
  if (!/^\d+(\.\d{1,2})?$/.test(poolPct)) fields.target_pool_percent = 'Enter a percentage from 0.00 to 30.00.';
  if (Object.keys(fields).length > 0) throw new HttpError(422, 'validation', 'Some fields need attention.', fields);
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const dup = await client.query('SELECT id FROM saved_scenarios WHERE lower(name) = lower($1)', [name]);
      if (dup.rows.length > 0) {
        throw new HttpError(409, 'scenario_name_taken', 'A saved scenario already has that name.');
      }
      const next = await client.query<{ max: string | null }>(
        "SELECT max(substring(id from 5)::bigint)::text AS max FROM saved_scenarios WHERE id LIKE 'SCN-%'",
      );
      const id = `SCN-${String(Number(next.rows[0]?.max ?? 0) + 1).padStart(3, '0')}`;
      await client.query(
        'INSERT INTO saved_scenarios (id, name, pre_money, investment, target_pool_percent) VALUES ($1,$2,$3,$4,$5)',
        [id, name, pre, investment, poolPct],
      );
      const admins = await client.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin' AND access = 'active'");
      for (const a of admins.rows) await emitFor(client, a.id, 'scenario_saved', { scenario_id: id, name });
      await client.query('COMMIT');
      const at = new Date();
      return {
        scenario: { id, name, pre_money: pre, investment, target_pool_percent: poolPct, saved_at: at.toISOString() },
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
  });
});

// local imports resolved through the modules that own them
import { currentValuation } from './routes-grants.js';
import { fullyDilutedTotal, poolFigures } from './register.js';

async function currentValuationRef(client: PoolClient, at: Date) {
  return currentValuation(client, at);
}
async function fullyDilutedRef(client: PoolClient): Promise<number> {
  return fullyDilutedTotal(client);
}
async function poolFiguresRef(client: PoolClient) {
  return poolFigures(client);
}
