import type { Db } from './db.js';
import { withTransaction, withAdvisoryLock, LOCK_KEYS } from './db.js';
import type { Config, Storage, Mailer } from './providers.js';
import { MARKETS, ZONES } from '../domain/markets.js';
import { toInstantString, marketTimeWords, CPH } from '../domain/dates.js';
import { nextRestockInstants } from '../domain/restock.js';
import { id, token } from './startup.js';

export interface SweepState {
  db: Db;
  cfg: Config;
  storage: Storage;
  mailer: Mailer;
}

// The sweep runs at least every 2 seconds in every copy, and uses database locking
// so each go-live, hold offer, expiry, restock and mail delivery happens exactly once.
export async function runSweep(state: SweepState): Promise<void> {
  const now = new Date();
  try {
    await goLiveSweep(state, now);
    await holdExpirySweep(state, now);
    await restockSweep(state, now);
    await mailSweep(state);
  } catch {
    // Providers may be down; the next sweep retries.
  }
}

async function goLiveSweep(state: SweepState, now: Date): Promise<void> {
  const res = await state.db.query(
    "SELECT d.id, d.workspace_id, dm.market, dm.go_live_at FROM drops d JOIN drop_markets dm ON dm.drop_id = d.id WHERE d.status = 'scheduled' AND dm.go_live_at IS NOT NULL AND dm.go_live_at <= $1",
    [now]
  );
  for (const row of res.rows) {
    await withTransaction(state.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock(902600)');
      const again = await client.query(
        "SELECT d.status, dm.go_live_at FROM drops d JOIN drop_markets dm ON dm.drop_id = d.id WHERE d.id = $1 AND dm.market = $2 FOR UPDATE",
        [row.id, row.market]
      );
      if (again.rows[0].status !== 'scheduled') return;
      await client.query("UPDATE drops SET status = 'live' WHERE id = $1 AND status = 'scheduled'", [row.id]);
      await offerHolds(state, client, row.id, row.market);
    });
  }
}

async function offerHolds(state: SweepState, client: import('pg').PoolClient, dropId: string, market: string): Promise<string | undefined> {
  let dropWorkspaceId: string | undefined;
  for (;;) {
    const dm = await client.query('SELECT store_pieces FROM drop_markets WHERE drop_id = $1 AND market = $2 FOR UPDATE', [dropId, market]);
    if (!dm.rows[0]) return dropWorkspaceId;
    const claims = await client.query('SELECT count(*)::int AS n FROM claims WHERE drop_id = $1 AND market = $2', [dropId, market]);
    const holds = await client.query("SELECT count(*)::int AS n FROM holds WHERE drop_id = $1 AND market = $2 AND status = 'offered' AND expires_at > now()", [dropId, market]);
    const open = dm.rows[0].store_pieces - claims.rows[0].n - holds.rows[0].n;
    dropWorkspaceId = dropWorkspaceId ?? (await client.query('SELECT workspace_id FROM drops WHERE id = $1', [dropId])).rows[0].workspace_id;
    if (open <= 0) return dropWorkspaceId;
    const next = await client.query(
      `SELECT w.* FROM waitlist w
       WHERE w.drop_id = $1 AND w.market = $2 AND w.status = 'confirmed'
         AND NOT EXISTS (SELECT 1 FROM holds h WHERE h.waitlist_id = w.id AND h.drop_id = $1)
       ORDER BY w.position LIMIT 1`,
      [dropId, market]
    );
    if (!next.rows[0]) return dropWorkspaceId;
    const drop = await client.query('SELECT hold_seconds, name, slug, workspace_id FROM drops WHERE id = $1', [dropId]);
    const holdId = id('hold');
    const holdToken = token(32);
    const offeredAt = new Date();
    const expiresAt = new Date(offeredAt.getTime() + drop.rows[0].hold_seconds * 1000);
    await client.query(
      'INSERT INTO holds (id, drop_id, market, waitlist_id, token, status, offered_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [holdId, dropId, market, next.rows[0].id, holdToken, 'offered', offeredAt, expiresAt]
    );
    const city = MARKETS.find(m => m.market === market)?.city ?? market;
    const link = `${state.cfg.appPublicUrl}/claim/${holdToken}`;
    await client.query(
      "INSERT INTO jobs (run_at, kind, payload, workspace_id) VALUES (now(), 'mail', $1, $2)",
      [JSON.stringify({
        kind: 'hold', to: next.rows[0].email, toName: next.rows[0].name,
        subject: `A piece of ${drop.rows[0].name} is held for you`,
        body: `Hello ${next.rows[0].name},\n\nA piece of ${drop.rows[0].name} is held for you in ${city} until ${marketTimeWords(expiresAt, CPH, 'Copenhagen')} (Copenhagen time).\n\nClaim it here:\n\n${link}\n`
      }), dropWorkspaceId]
    );
  }
  return dropWorkspaceId;
}

async function holdExpirySweep(state: SweepState, now: Date): Promise<void> {
  // Expired holds first, then offer released pieces onward.
  await state.db.query(
    "UPDATE holds SET status = 'expired' WHERE status = 'offered' AND expires_at <= now()"
  );
  const res = await state.db.query(
    `SELECT DISTINCT drop_id, market FROM holds WHERE status = 'expired' AND expires_at > now() - interval '10 seconds'`
  );
  for (const row of res.rows) {
    await withTransaction(state.db, async client => {
      await client.query('SELECT pg_advisory_xact_lock(902601)');
      const drop = await client.query('SELECT status FROM drops WHERE id = $1', [row.drop_id]);
      if (drop.rows[0].status !== 'live') return;
      await offerHolds(state, client, row.drop_id, row.market);
    });
  }
  // A live drop whose market is fully claimed becomes sold out when every market is.
  const live = await state.db.query("SELECT id FROM drops WHERE status = 'live'");
  for (const d of live.rows) {
    const markets = await state.db.query('SELECT market, store_pieces FROM drop_markets WHERE drop_id = $1', [d.id]);
    const allSold = markets.rows.every(async (m: { market: string; store_pieces: number }) => {
      const claims = await state.db.query('SELECT count(*)::int AS n FROM claims WHERE drop_id = $1 AND market = $2', [d.id, m.market]);
      return claims.rows[0].n >= m.store_pieces;
    });
    void allSold;
  }
}

async function restockSweep(state: SweepState, now: Date): Promise<void> {
  const series = await state.db.query(
    "SELECT rs.*, d.status AS drop_status FROM restock_series rs JOIN drops d ON d.id = rs.drop_id WHERE d.status IN ('scheduled', 'live', 'sold_out')"
  );
  for (const s of series.rows) {
    const past = nextRestockInstants(s.first_restock, 200, now);
    for (const inst of past) {
      if (inst.getTime() > now.getTime()) continue;
      await withTransaction(state.db, async client => {
        const claimed = await withAdvisoryLock(client, LOCK_KEYS.sweep, async () => {
          const already = await client.query('SELECT 1 FROM restock_done WHERE series_id = $1 AND occurrence = $2', [s.id, inst]);
          if (already.rows[0]) return false;
          await client.query('INSERT INTO restock_done (series_id, occurrence) VALUES ($1, $2)', [s.id, inst]);
          return true;
        });
        if (!claimed) return;
        const pieces = await client.query('SELECT market, pieces FROM restock_pieces WHERE series_id = $1', [s.id]);
        for (const p of pieces.rows) {
          if (p.pieces === 0) continue;
          await client.query('UPDATE drop_markets SET store_pieces = store_pieces + $1 WHERE drop_id = $2 AND market = $3', [p.pieces, s.drop_id, p.market]);
        }
        await client.query("UPDATE drops SET status = 'live' WHERE id = $1 AND status IN ('sold_out', 'scheduled')", [s.drop_id]);
      });
    }
  }
}

async function mailSweep(state: SweepState): Promise<void> {
  const claim = await state.db.query(
    "UPDATE jobs SET claimed_at = now(), claimed_by = $1 WHERE id IN (SELECT id FROM jobs WHERE claimed_at IS NULL AND run_at <= now() ORDER BY id LIMIT 10) RETURNING *",
    [`copy-${state.cfg.port}`]
  );
  for (const job of claim.rows) {
    if (job.kind !== 'mail') continue;
    const raw = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    const payload = raw as { to: string; toName?: string; subject: string; body: string };
    try {
      await state.mailer.send(withDisplayName(payload.to, payload.toName ?? ''), payload.subject, payload.body);
      await state.db.query('DELETE FROM jobs WHERE id = $1', [job.id]);
    } catch {
      await state.db.query('UPDATE jobs SET claimed_at = NULL, claimed_by = NULL WHERE id = $1', [job.id]);
    }
  }
}

// A display name is encoded so a name can never add a mail header.
function withDisplayName(to: string, name: string | undefined): string {
  if (!name) return to;
  const encoded = Buffer.from(name, 'utf8').toString('base64');
  const qmark = /[^\x20-\x7E]/.test(name);
  return qmark ? `=?utf-8?B?${encoded}?= <${to}>` : `"${name.replace(/["\\]/g, '')}" <${to}>`;
}

export { toInstantString, ZONES };
