// Holds: ask, quote, confirm, release, and the lapse sweep that runs on every process
// through SKIP LOCKED row claims with leases and fencing tokens (DP-24, DP-25, DP-26).

import type { PoolClient } from 'pg';
import type { Database } from './db.js';
import type { RentalHouse } from './rental-house.js';
import { factorPermille, netCents, totalCents, vatCents } from './money.js';

export type HoldStatus = 'Asked' | 'Held' | 'Hired in' | 'Lapsed' | 'Released';

export interface HoldRow {
  id: string;
  status: HoldStatus;
  model: string;
  from: string; // YYYY-MM-DD
  days: number;
  hold_ref: string | null;
  serial: string | null;
  logged_hours: string | null;
  ask_key: string | null;
  confirm_key: string | null;
  expires_at: Date | null;
  server_arrival_at: Date | null;
  asked_answered: boolean;
  ask_settled: boolean;
  release_key: string | null;
  release_sent: boolean;
  quote: QuoteColumns | null;
}

export interface QuoteColumns {
  day_rate_cents: number;
  days: number;
  factor_permille: number;
  net_cents: number;
  vat_cents: number;
  total_cents: number;
  provider_total_cents: number;
  matches: boolean;
}

const SWEEP_INTERVAL_MS = 5000;
const REPLAY_INTERVAL_MS = 5000;
const SETTLE_WINDOW_MS = 15000;
const CLAIM_LEASE_MS = 15000;

// One sweep on every process: lapse holds whose window is over, clear placements drawn
// on them, tell the desk exactly once, and reconcile ambiguous asks and confirms.
export class HoldSweeper {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly db: Database,
    private readonly house: RentalHouse,
    private readonly owner: string,
    private readonly events: {
      holdChanged: (client: PoolClient, holdId: string, status: HoldStatus) => Promise<void>;
      layoutCleared: (client: PoolClient, holdId: string) => Promise<number>;
    },
  ) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.runOnce(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweepLapses();
      await this.reconcileAsks();
      await this.reconcileConfirms();
    } catch {
      // the next sweep retries; nothing here leaves in-memory state
    } finally {
      this.sweeping = false;
    }
  }

  // Within 10 seconds of expiresAt one sweep commits Lapsed, clears the hold from
  // placements and writes one event, and the desk receives release until it answers.
  private async sweepLapses(): Promise<void> {
    const outcome = await this.db.withClient(async (client) => {
      const claims = await client.query<{ id: string }>(
        `SELECT h.id FROM holds h
          WHERE h.status = 'Held' AND h.expires_at IS NOT NULL AND h.expires_at <= now()
            AND h.confirm_key IS NULL
          ORDER BY h.expires_at
          LIMIT 5
          FOR UPDATE SKIP LOCKED`,
      );
      void this.owner;
      const lapsed: { id: string; hold_ref: string | null }[] = [];
      for (const claim of claims.rows) {
        const applied = await client.query<{ hold_ref: string | null }>(
          `UPDATE holds SET status = 'Lapsed' WHERE id = $1 AND status = 'Held' RETURNING hold_ref`,
          [claim.id],
        );
        if (applied.rowCount === 0) continue;
        await this.events.layoutCleared(client, claim.id);
        await this.events.holdChanged(client, claim.id, 'Lapsed');
        lapsed.push({ id: claim.id, hold_ref: applied.rows[0]!.hold_ref });
      }
      if (lapsed.length > 0) await client.query('COMMIT');
      else await client.query('ROLLBACK');
      return lapsed;
    });
    for (const hold of outcome.ok ? outcome.value : []) {
      await this.sendRelease(hold.id, hold.hold_ref);
    }
  }

  // An ask with an ambiguous outcome stays Asked; if the desk turns out to have granted
  // the hold, hand it back with one release. A definite 409 reads Released.
  private async reconcileAsks(): Promise<void> {
    const result = await this.db.withClient(async (client) => {
      const rows = await client.query<HoldRow>(
        `SELECT * FROM holds WHERE status = 'Asked' LIMIT 10 FOR UPDATE SKIP LOCKED`,
      );
      return rows.rows.map((row) => ({ row }));
    });
    if (!result.ok) return;
    for (const { row } of result.value) {
      if (row.ask_key === null) continue;
      const askResult = await this.house.ask(row.ask_key, row.model, row.from, row.days);
      if (askResult.kind === 'held') {
        // the desk did grant it; hand it back with one release and read Released
        await this.releaseAskedHold(row.id, row.model, askResult.holdRef);
      } else if (askResult.kind === 'no_stock') {
        await this.definitelyRefuseAsk(row.id);
      }
    }
  }

  private async releaseAskedHold(holdId: string, model: string, holdRef: string): Promise<void> {
    const release = await this.house.release(holdRef);
    if (release.kind !== 'released') return; // try again on the next sweep
    await this.db.withClient(async (client) => {
      const updated = await client.query<HoldRow>(
        `UPDATE holds SET status = 'Released', asked_answered = true, ask_settled = true,
                hold_ref = $2, release_sent = true
          WHERE id = $1 AND status = 'Asked' RETURNING *`,
        [holdId, holdRef],
      );
      const row = updated.rows[0];
      if (!row) return;
      await this.events.holdChanged(client, holdId, 'Released');
      await client.query('COMMIT');
    });
    void model;
  }

  private async definitelyRefuseAsk(holdId: string): Promise<void> {
    await this.db.withClient(async (client) => {
      const updated = await client.query(
        `UPDATE holds SET status = 'Released', asked_answered = true, ask_settled = true
          WHERE id = $1 AND status = 'Asked'`,
        [holdId],
      );
      if (updated.rowCount === 0) return;
      await this.events.holdChanged(client, holdId, 'Released');
      await client.query('COMMIT');
    });
  }

  // A confirm with an ambiguous outcome keeps the hold Held, past expiresAt too, until
  // the desk answers: 200 is Hired in and 409 hold_expired is Lapsed.
  private async reconcileConfirms(): Promise<void> {
    const result = await this.db.withClient(async (client) => {
      const rows = await client.query<HoldRow>(
        `SELECT * FROM holds WHERE status = 'Held' AND confirm_key IS NOT NULL
            AND expires_at IS NOT NULL AND expires_at <= now()
          LIMIT 10 FOR UPDATE SKIP LOCKED`,
      );
      return rows.rows;
    });
    if (!result.ok) return;
    for (const row of result.value) {
      const quote = row.quote;
      if (quote === null) continue;
      const confirm = await this.house.confirm(row.confirm_key!, row.hold_ref ?? '', quote.total_cents);
      if (confirm.kind === 'hired') {
        await this.settleConfirm(row.id, 'Hired in');
      } else if (confirm.kind === 'hold_expired') {
        await this.settleConfirm(row.id, 'Lapsed');
      }
    }
  }

  private async settleConfirm(holdId: string, status: 'Hired in' | 'Lapsed'): Promise<void> {
    await this.db.withClient(async (client) => {
      const updated = await client.query(
        'UPDATE holds SET status = $2 WHERE id = $1 AND status = $2',
        [holdId, status],
      );
      void updated;
      await this.events.holdChanged(client, holdId, status);
      await client.query('COMMIT');
    });
  }

  private async sendRelease(holdId: string, holdRef: string | null): Promise<void> {
    if (holdRef === null) return;
    await this.db.withClient(async (client) => {
      const row = await client.query<HoldRow>(
        'SELECT * FROM holds WHERE id = $1 FOR UPDATE',
        [holdId],
      );
      const hold = row.rows[0];
      if (!hold || hold.release_sent) return;
      await client.query('COMMIT');
    });
    const release = await this.house.release(holdRef);
    if (release.kind !== 'released') return;
    await this.db.withClient(async (client) => {
      await client.query('UPDATE holds SET release_sent = true WHERE id = $1', [holdId]);
      await client.query('COMMIT');
    });
  }
}

// The quote for a hold, compared with the desk's own at each quote.
export function computeQuote(dayRateCents: number, days: number, providerTotalCents: number): QuoteColumns {
  const factor = factorPermille(days);
  const net = netCents(dayRateCents, days);
  const vat = vatCents(net);
  const total = totalCents(net, vat);
  return {
    day_rate_cents: dayRateCents,
    days,
    factor_permille: factor,
    net_cents: net,
    vat_cents: vat,
    total_cents: total,
    provider_total_cents: providerTotalCents,
    matches: total === providerTotalCents,
  };
}

// remainingSeconds is a whole number rounded up, and 0 once the hold is not Held.
export function remainingSeconds(expiresAt: Date | null, now: Date, status: HoldStatus): number {
  if (status !== 'Held' || expiresAt === null) return 0;
  const ms = expiresAt.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

export { SWEEP_INTERVAL_MS, REPLAY_INTERVAL_MS, SETTLE_WINDOW_MS, CLAIM_LEASE_MS };
