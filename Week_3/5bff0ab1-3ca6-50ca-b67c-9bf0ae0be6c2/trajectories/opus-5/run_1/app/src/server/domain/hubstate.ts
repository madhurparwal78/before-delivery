import { FINISHES, HUBS, MODELS, type HubId } from '../../shared/catalogue.js';
import type { StockRow } from '../../shared/types.js';
import { appNow, labelAsOf } from '../clock.js';
import { one, query, type Row, type Tx } from '../db.js';
import { channels, publishHint } from '../ledger.js';

export interface HubStatus {
  hub: HubId;
  counting: boolean;
  stale: boolean;
  staleReason: 'system' | 'count' | null;
  stockAsOf: Date;
  stockAsOfLabel: string;
  seq: number;
}

interface HubStateRow extends Row {
  hub: string;
  counting: boolean;
  count_started_at: Date | null;
  stock_as_of: Date;
  stale_system_until: Date | null;
  seq: number;
  ledger_ok: boolean;
}

const HUB_STATUS_SQL = `
  select h.hub, h.counting, h.count_started_at, h.stock_as_of, h.stale_system_until,
         s.seq, (select ok from ledger_health where id = 1) as ledger_ok
  from hub_state h join hub_seq s on s.hub = h.hub
`;

function toStatus(row: HubStateRow, now: Date): HubStatus {
  const damaged = row.stale_system_until !== null && row.stale_system_until.getTime() > now.getTime();
  const system = !row.ledger_ok || damaged;
  const stale = system || row.counting;
  const stockAsOf = row.counting && row.count_started_at ? row.count_started_at : row.stock_as_of;
  return {
    hub: row.hub as HubId,
    counting: row.counting,
    stale,
    staleReason: system ? 'system' : row.counting ? 'count' : null,
    stockAsOf,
    stockAsOfLabel: labelAsOf(stockAsOf, now),
    seq: row.seq,
  };
}

export async function hubStatus(hub: HubId): Promise<HubStatus> {
  const now = appNow();
  const row = await one<HubStateRow>(`${HUB_STATUS_SQL} where h.hub = $1`, [hub]);
  if (!row) throw new Error(`unknown hub ${hub}`);
  return toStatus(row, now);
}

export async function readSeqs(): Promise<Map<HubId, number>> {
  const rows = await query<{ hub: string; seq: number }>('select hub, seq from hub_seq');
  return new Map(rows.map((row) => [row.hub as HubId, row.seq]));
}

export async function bumpSeq(hub: HubId, tx?: Tx): Promise<void> {
  const runner = tx ?? { query };
  await runner.query('update hub_seq set seq = seq + 1 where hub = $1', [hub]);
  queueHint(channels.live(), { hub });
}

export async function bumpAllSeqs(tx?: Tx): Promise<void> {
  const runner = tx ?? { query };
  await runner.query('update hub_seq set seq = seq + 1');
  for (const h of HUBS) queueHint(channels.live(), { hub: h.id });
}

export async function bumpRiderRev(riderId: string, tx?: Tx): Promise<void> {
  const runner = tx ?? { query };
  await runner.query('update users set rev = rev + 1 where id = $1', [riderId]);
  queueHint(channels.rider(), { rider: riderId });
}

function queueHint(channel: string, payload: unknown): void {
  setImmediate(() => {
    void publishHint(channel, payload);
  });
}

export async function stockRows(hub: HubId): Promise<StockRow[]> {
  const rows = await query<{ model: string; finish: string; on_hand: number; held: number }>(
    `select s.model, s.finish, s.on_hand,
            (select count(*) from locks l
              where l.hub = s.hub and l.model = s.model and l.finish = s.finish and l.hold_active) as held
     from stock s where s.hub = $1`,
    [hub],
  );
  const byKey = new Map(rows.map((row) => [`${row.model}:${row.finish}`, row]));
  const out: StockRow[] = [];
  for (const m of MODELS) {
    for (const f of FINISHES) {
      const row = byKey.get(`${m.id}:${f.id}`);
      const onHand = row?.on_hand ?? 0;
      const held = Number(row?.held ?? 0);
      out.push({
        model: m.id,
        finish: f.id,
        onHand,
        held,
        unitsLeft: Math.max(0, onHand - held),
      });
    }
  }
  return out;
}

export async function startStockCount(hub: HubId): Promise<boolean> {
  const now = appNow();
  const rows = await query(
    `update hub_state set counting = true, count_started_at = $2
     where hub = $1 and counting = false returning hub`,
    [hub, now],
  );
  if (rows.length === 0) return false;
  await bumpSeq(hub);
  return true;
}

export async function markHubDamaged(hub: HubId, forMs: number): Promise<void> {
  const until = new Date(appNow().getTime() + forMs);
  const rows = await query(
    `update hub_state set stale_system_until = $2
     where hub = $1 and (stale_system_until is null or stale_system_until < $2) returning hub`,
    [hub, until],
  );
  if (rows.length > 0) await bumpSeq(hub);
}

export async function clearHubDamage(hub: HubId): Promise<void> {
  const now = appNow();
  const rows = await query(
    `update hub_state set stale_system_until = null
     where hub = $1 and stale_system_until is not null and stale_system_until <= $2 returning hub`,
    [hub, now],
  );
  if (rows.length > 0) await bumpSeq(hub);
}

export async function setLedgerOk(ok: boolean): Promise<void> {
  const rows = await query(
    `update ledger_health set ok = $1, changed_at = now() where id = 1 and ok <> $1 returning ok`,
    [ok],
  );
  if (rows.length > 0) await bumpAllSeqs();
}

export async function markStockAsOf(hub: HubId, at: Date): Promise<void> {
  await query(`update hub_state set stock_as_of = $2 where hub = $1 and counting = false`, [
    hub,
    at,
  ]);
}
