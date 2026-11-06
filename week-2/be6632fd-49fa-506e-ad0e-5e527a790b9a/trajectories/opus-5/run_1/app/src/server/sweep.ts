import { deliverQueuedMail, queueMail } from './db/outbox.ts';
import { pool, transact, tryAdvisoryLock, type Transaction } from './db/pool.ts';
import { seedLookImages } from './db/seed.ts';
import { marketCity, MARKETS, type Market } from '../domain/markets.ts';
import { restockOccurrences } from '../domain/restocks.ts';
import { parseLocalDateTime } from '../domain/time.ts';
import { newId, newToken } from './services/crypto.ts';

const SWEEP_LOCK = 0x484f_5554;

interface LiveMarketRow {
  drop_id: string;
  drop_name: string;
  hold_seconds: number;
  market: Market;
  store_pieces: number;
  go_live_at_ms: number;
}

/** Opens each market at its go-live instant and moves its drop to live. */
async function openMarkets(tx: Transaction, nowMs: number): Promise<void> {
  await tx.query(
    `update drop_markets dm
        set opened_at_ms = $1
      from drops d
      where d.id = dm.drop_id
        and d.status in ('scheduled','live','sold_out')
        and dm.opened_at_ms is null
        and dm.go_live_at_ms is not null
        and dm.go_live_at_ms <= $1`,
    [nowMs],
  );
  await tx.query(
    `update drops d
        set status = 'live'
      where d.status = 'scheduled'
        and exists (select 1 from drop_markets dm
                     where dm.drop_id = d.id and dm.go_live_at_ms is not null and dm.go_live_at_ms <= $1)`,
    [nowMs],
  );
}

/** Marks every hold whose end has passed, so its piece rejoins open pieces. */
async function expireHolds(tx: Transaction, nowMs: number): Promise<void> {
  await tx.query(
    `update holds set status = 'expired'
      where status = 'offered' and expires_at_ms <= $1`,
    [nowMs],
  );
}

/**
 * Offers one hold to each confirmed waitlist member of a live market who has never been offered
 * one for this drop, in join order and while the market has open pieces.
 */
async function offerHolds(tx: Transaction, nowMs: number): Promise<void> {
  const markets = await tx.query<LiveMarketRow>(
    `select dm.drop_id, d.name as drop_name, d.hold_seconds, dm.market, dm.store_pieces, dm.go_live_at_ms
       from drop_markets dm
       join drops d on d.id = dm.drop_id
      where d.status in ('live','sold_out')
        and dm.go_live_at_ms is not null and dm.go_live_at_ms <= $1
        and dm.store_pieces > 0
        and exists (select 1 from waitlist_members w
                     where w.drop_id = dm.drop_id and w.market = dm.market
                       and w.status = 'confirmed' and w.offered_at_ms is null)`,
    [nowMs],
  );

  for (const market of markets) {
    const counts = await tx.queryOne<{ claimed: number; held: number }>(
      `select (select count(*) from claims c where c.drop_id = $1 and c.market = $2) as claimed,
              (select count(*) from holds h
                where h.drop_id = $1 and h.market = $2 and h.status = 'offered' and h.expires_at_ms > $3) as held`,
      [market.drop_id, market.market, nowMs],
    );
    let open = market.store_pieces - Number(counts?.claimed ?? 0) - Number(counts?.held ?? 0);
    if (open <= 0) continue;

    const waiting = await tx.query<{ id: string; name: string; email: string }>(
      `select id, name, email from waitlist_members
        where drop_id = $1 and market = $2 and status = 'confirmed' and offered_at_ms is null
        order by position
        limit $3
        for update skip locked`,
      [market.drop_id, market.market, open],
    );

    for (const member of waiting) {
      if (open <= 0) break;
      const token = newToken();
      const expiresAtMs = nowMs + market.hold_seconds * 1000;
      const inserted = await tx.query<{ id: string }>(
        `insert into holds (id, drop_id, market, waitlist_member_id, token, offered_at_ms, expires_at_ms, status)
         values ($1,$2,$3,$4,$5,$6,$7,'offered')
         on conflict (drop_id, waitlist_member_id) do nothing
         returning id`,
        [newId(), market.drop_id, market.market, member.id, token, nowMs, expiresAtMs],
      );
      if (inserted.length === 0) continue;
      await tx.query('update waitlist_members set offered_at_ms = $2 where id = $1', [
        member.id,
        nowMs,
      ]);
      await queueMail(
        tx,
        {
          kind: 'hold',
          email: member.email,
          name: member.name,
          dropName: market.drop_name,
          market: market.market,
          city: marketCity(market.market),
          token,
          expiresAtMs,
        },
        `hold:${token}`,
      );
      open -= 1;
    }
  }
}

interface SeriesRow {
  id: string;
  drop_id: string;
  first_restock: string;
  pieces: Record<string, number>;
}

/** Adds each due restock series' pieces to every market exactly once. */
async function runRestocks(tx: Transaction, nowMs: number): Promise<void> {
  const series = await tx.query<SeriesRow>(
    `select rs.id, rs.drop_id, rs.first_restock, rs.pieces
       from restock_series rs
       join drops d on d.id = rs.drop_id
      where d.status <> 'withdrawn'`,
  );
  for (const entry of series) {
    const first = parseLocalDateTime(entry.first_restock);
    if (first === null) continue;
    const due = restockOccurrences(first, 0, 520).filter((instant) => instant <= nowMs);
    for (const occurrence of due) {
      const claimed = await tx.query<{ series_id: string }>(
        `insert into restock_runs (series_id, occurrence_ms, ran_at_ms) values ($1,$2,$3)
         on conflict (series_id, occurrence_ms) do nothing
         returning series_id`,
        [entry.id, occurrence, nowMs],
      );
      if (claimed.length === 0) continue;
      for (const market of MARKETS) {
        const pieces = entry.pieces[market] ?? 0;
        if (pieces === 0) continue;
        await tx.query(
          'update drop_markets set store_pieces = store_pieces + $3 where drop_id = $1 and market = $2',
          [entry.drop_id, market, pieces],
        );
      }
    }
  }
}

/** Keeps each drop's live and sold-out state in step with its markets' claims. */
async function settleSoldOut(tx: Transaction): Promise<void> {
  await tx.query(
    `update drops d set status = 'sold_out'
      where d.status = 'live'
        and not exists (select 1 from drop_markets dm
                         where dm.drop_id = d.id
                           and dm.store_pieces > (select count(*) from claims c
                                                   where c.drop_id = d.id and c.market = dm.market))`,
  );
  await tx.query(
    `update drops d set status = 'live'
      where d.status = 'sold_out'
        and exists (select 1 from drop_markets dm
                     where dm.drop_id = d.id
                       and dm.store_pieces > (select count(*) from claims c
                                               where c.drop_id = d.id and c.market = dm.market))`,
  );
}

let imagesPending = true;

async function runOnce(): Promise<void> {
  const nowMs = Date.now();
  await tryAdvisoryLock(SWEEP_LOCK, async () => {
    await transact(async (tx) => {
      await openMarkets(tx, nowMs);
      await expireHolds(tx, nowMs);
      await runRestocks(tx, nowMs);
      await settleSoldOut(tx);
      await offerHolds(tx, nowMs);
    });
  });
  await deliverQueuedMail();
  if (imagesPending) {
    try {
      await seedLookImages();
      imagesPending = false;
    } catch {
      imagesPending = true;
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startSweep(): void {
  if (timer !== null) return;
  const tick = (): void => {
    void runOnce().catch(() => undefined);
  };
  tick();
  timer = setInterval(tick, 1500);
}

export async function closeSweep(): Promise<void> {
  if (timer !== null) clearInterval(timer);
  await pool.end();
}
