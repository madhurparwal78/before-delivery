import { one, query, tx } from './db/pool.js';
import {
  PAYMENT_TIMEOUT_MS,
  approve,
  backgroundCheck,
  decideByClock,
  publishServer,
  refresh,
} from './domain/billing.js';
import { retryPendingCheckpoints } from './domain/chapters.js';
import { appendEvent, pruneEvents } from './domain/events.js';
import { type GameRow, endWithoutMove, pushAnnouncement, publishTable, storeAndSettle } from './domain/games.js';
import { loadServerById, type ServerRow } from './domain/servers.js';
import { cascadeSuspension, finishCascade } from './domain/suspension.js';
import { loadTable } from './domain/tables.js';
import type { TableRow } from './domain/games.js';
import { clearAccepts, publishTrade, type TradeRow } from './domain/trade.js';
import { weatherOf, weatherPeriod } from './domain/weather.js';
import { creditPurchase } from './routes/coins.js';
import * as kb from './services/killbill.js';
import { flushHeldMail } from './services/mail.js';

const timers: NodeJS.Timeout[] = [];

/** Runs a loop every `ms`, never starting a tick while the previous one runs. */
const every = (ms: number, work: () => Promise<void>): void => {
  let running = false;
  const run = (): void => {
    if (running) return;
    running = true;
    work()
      .catch((error: unknown) => {
        process.stderr.write(`${work.name} failed: ${String(error)}\n`);
      })
      .finally(() => {
        running = false;
      });
  };
  timers.push(setInterval(run, ms));
};

export function startWorkers(): void {
  /* The grace window is checked at least once a second. */
  every(1000, suspensionLoop);
  /* The settler runs at least every 5 seconds. */
  every(5000, settlePayments);
  /* Every server's billing state is re-read at least every 10 seconds. */
  every(1000, billingLoop);
  every(1000, turnClockLoop);
  every(10000, flushHeldMail);
  every(10000, retryPendingCheckpoints);
  every(10000, retryPendingResults);
  every(5000, lapsedAcceptsLoop);
  every(250, weatherLoop);
  every(20000, presenceLoop);
  every(60000, pruneEvents);
}

/** past_due becomes suspended on the server's own clock. */
async function suspensionLoop(): Promise<void> {
  const due = await query<ServerRow>(
    `SELECT * FROM servers WHERE status = 'past_due' AND suspends_at IS NOT NULL AND suspends_at <= now()`,
  );
  for (const server of due) {
    if (decideByClock(server, new Date()) !== 'suspended') continue;
    const applied = await tx(async (client) => {
      const locked = await client.query<ServerRow>(
        `SELECT * FROM servers WHERE id = $1 AND status = 'past_due' FOR UPDATE`,
        [server.id],
      );
      if (locked.rows[0] === undefined) return null;
      const rows = await client.query<ServerRow>(
        `UPDATE servers SET status = 'suspended', revision = revision + 1 WHERE id = $1 RETURNING *`,
        [server.id],
      );
      const cascade = await cascadeSuspension(client, server.id);
      return { server: rows.rows[0], cascade };
    });
    if (applied === null) continue;
    await finishCascade(applied.cascade);
    await publishServer(applied.server);
  }
}

const BILLING_CHECK_SECONDS = 9;

/**
 * Every server's billing state is re-read at least every 10 seconds. The
 * instances share the work: each check is claimed on the server row, and an
 * instance that cannot reach Kill Bill hands its claim straight back.
 */
async function billingLoop(): Promise<void> {
  for (;;) {
    const claimed = await one<ServerRow & { previous_poll: Date | null }>(
      `WITH due AS (
         SELECT id, polled_at FROM servers
          WHERE polled_at IS NULL OR polled_at < now() - make_interval(secs => $1)
          ORDER BY polled_at NULLS FIRST LIMIT 1 FOR UPDATE SKIP LOCKED)
       UPDATE servers s SET polled_at = now() FROM due WHERE s.id = due.id
       RETURNING s.*, due.polled_at AS previous_poll`,
      [BILLING_CHECK_SECONDS],
    );
    if (claimed === null) return;
    const reached =
      claimed.kb_account_id === null
        ? await adoptKillbillRecords(claimed)
        : await backgroundCheck(claimed);
    if (!reached) {
      await query('UPDATE servers SET polled_at = $2 WHERE id = $1', [
        claimed.id,
        claimed.previous_poll,
      ]);
      return;
    }
  }
}

/**
 * At first start each seeded server gets its Kill Bill account, tag and
 * subscription, then its first invoice is approved.
 */
async function adoptKillbillRecords(server: ServerRow): Promise<boolean> {
  let accountId: string;
  try {
    accountId = await kb.ensureAccount(`plotwright-${server.id}`, server.name);
    await kb.ensureAutoPayOff(accountId);
    await kb.ensureSubscription(accountId, `plotwright-${server.id}-plan`, server.plan);
  } catch {
    return false;
  }
  await query('UPDATE servers SET kb_account_id = $2, revision = revision + 1 WHERE id = $1', [
    server.id,
    accountId,
  ]);
  const updated = await loadServerById(server.id);
  if (updated === null) return true;
  try {
    await approve(updated);
  } catch {
    /* The next pass reads the account again and applies the status table. */
  }
  return true;
}

/**
 * Each pending payment is claimed with a row lock, so that one instance handles
 * it at a time, and resent with the same key when Kill Bill still has none.
 */
async function settlePayments(): Promise<void> {
  const pending = await query<{
    id: string;
    server_id: string;
    kind: string;
    purchase_id: string | null;
    kb_account_id: string;
    external_key: string;
    amount: string;
    attempted_at: Date;
    resent_at: Date | null;
  }>(`SELECT * FROM pending_payments WHERE state = 'pending' ORDER BY attempted_at LIMIT 25`);

  for (const row of pending) {
    const claimed = await tx(async (client) => {
      const locked = await client.query<{ id: string }>(
        `SELECT id FROM pending_payments WHERE id = $1 AND state = 'pending' FOR UPDATE SKIP LOCKED`,
        [row.id],
      );
      return locked.rows[0] ?? null;
    });
    if (claimed === null) continue;

    let payment: kb.KbPayment | null;
    try {
      payment = await kb.paymentByExternalKey(row.external_key);
    } catch {
      continue;
    }

    if (payment !== null && kb.paymentSucceeded(payment)) {
      await query(`UPDATE pending_payments SET state = 'done' WHERE id = $1`, [row.id]);
      if (row.kind === 'coins' && row.purchase_id !== null) {
        await creditPurchase(row.purchase_id, payment.paymentId);
      }
      const server = await loadServerById(row.server_id);
      if (server !== null) await refresh(server);
      continue;
    }

    const since = Date.now() - (row.resent_at ?? row.attempted_at).getTime();
    if (payment === null && since >= 30000) {
      const invoiceId = await invoiceFor(row.kind, row.purchase_id, row.external_key);
      if (invoiceId === null) continue;
      try {
        await kb.payInvoice(
          row.kb_account_id,
          invoiceId,
          Number(row.amount),
          row.external_key,
          PAYMENT_TIMEOUT_MS,
        );
      } catch {
        /* The attempt stands; the same key is tried again later. */
      }
      await query('UPDATE pending_payments SET resent_at = now() WHERE id = $1', [row.id]);
    }
  }
}

async function invoiceFor(
  kind: string,
  purchaseId: string | null,
  externalKey: string,
): Promise<string | null> {
  if (kind === 'coins' && purchaseId !== null) {
    const row = await one<{ kb_invoice_id: string | null }>(
      'SELECT kb_invoice_id FROM coin_purchases WHERE id = $1',
      [purchaseId],
    );
    return row?.kb_invoice_id ?? null;
  }
  const match = /^pw-pay-(.+)$/.exec(externalKey);
  return match === null ? null : match[1];
}

/** The server checks turn deadlines at least once a second. */
async function turnClockLoop(): Promise<void> {
  const overdue = await query<GameRow>(
    `SELECT * FROM games WHERE state = 'in_play' AND deadline IS NOT NULL AND deadline <= now()`,
  );
  for (const game of overdue) {
    const table = await loadTable(game.table_id);
    if (table === null) continue;
    const ended = await tx(async (client) => {
      const locked = await client.query<GameRow>(
        `SELECT * FROM games WHERE id = $1 AND state = 'in_play' FOR UPDATE`,
        [game.id],
      );
      const current = locked.rows[0];
      if (current === undefined || current.deadline === null) return null;
      const lockedTable = await client.query<TableRow>(
        'SELECT * FROM game_tables WHERE id = $1 FOR UPDATE',
        [table.id],
      );
      const tableRow = lockedTable.rows[0];
      if (tableRow === undefined) return null;
      return endWithoutMove(
        client,
        tableRow,
        current,
        'timeout',
        current.to_move_seat,
        current.deadline,
      );
    });
    if (ended === null) continue;
    await publishTable(table.id);
    await pushAnnouncement(table.server_id, table.id, ended.game.result?.text ?? '');
    await storeAndSettle(ended.game.id);
  }
}

/** Results that could not be stored are retried until they settle. */
async function retryPendingResults(): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM games WHERE result IS NOT NULL AND (pending_store = true OR settled = false) LIMIT 25`,
  );
  for (const row of rows) await storeAndSettle(row.id);
}

/** An accept lapses 60 seconds after it is given. */
async function lapsedAcceptsLoop(): Promise<void> {
  const rows = await query<TradeRow>(
    `SELECT * FROM trades
      WHERE state = 'open'
        AND ((a_accepted_at IS NOT NULL AND a_accepted_at < now() - interval '60 seconds')
          OR (b_accepted_at IS NOT NULL AND b_accepted_at < now() - interval '60 seconds'))`,
  );
  for (const trade of rows) {
    await tx(async (client) => {
      const cleared = await clearAccepts(client, trade.id);
      await publishTrade(client, cleared);
    });
  }
}

let lastWeatherPeriod: number | null = null;

/**
 * Each weather change is pushed once, by whichever instance first claims the
 * new period on the server row, within a quarter second of the change.
 */
async function weatherLoop(): Promise<void> {
  const period = weatherPeriod(new Date());
  if (period === lastWeatherPeriod) return;
  const changed = await query<{ id: string; weather_seed: number }>(
    `WITH turned AS (
       SELECT id FROM servers
        WHERE weather_period IS DISTINCT FROM $1 FOR UPDATE SKIP LOCKED)
     UPDATE servers s SET weather_period = $1 FROM turned WHERE s.id = turned.id
     RETURNING s.id, s.weather_seed`,
    [period],
  );
  const firstPass = lastWeatherPeriod === null;
  lastWeatherPeriod = period;
  /* An instance's first pass only records the period it started in. */
  if (firstPass) return;
  for (const server of changed) {
    await appendEvent({
      serverId: server.id,
      stream: 'server',
      scopeId: server.id,
      kind: 'weather',
      payload: weatherOf(server.weather_seed),
    });
  }
}

/** Going offline is pushed within 20 seconds of the last stream closing. */
async function presenceLoop(): Promise<void> {
  const stale = await query<{ server_id: string; handle: string }>(
    `SELECT p.server_id, u.handle FROM presence p JOIN users u ON u.id = p.user_id
      WHERE p.open_count = 0 AND p.closed_at IS NOT NULL
        AND p.closed_at > now() - interval '60 seconds'`,
  );
  for (const row of stale) {
    await appendEvent({
      serverId: row.server_id,
      stream: 'server',
      scopeId: row.server_id,
      kind: 'presence',
      payload: { handle: row.handle, online: false },
    });
  }
  await query(`UPDATE presence SET closed_at = NULL WHERE open_count = 0`);
}
