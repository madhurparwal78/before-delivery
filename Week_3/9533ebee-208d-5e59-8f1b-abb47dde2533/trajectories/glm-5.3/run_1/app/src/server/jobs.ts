import type { App } from './app.js';
import { getConfig } from './config.js';
import { refreshAndEvaluate, canonical } from './market.js';
import { sendMail, marginSubject, marginBody, liquidationSubject, liquidationBody } from './mailer.js';
import { claimReadyEvents } from './outbox.js';
import { deliverEvent } from './svixClient.js';
import type { OutboxEvent, PositionEventData, SettlementEventData } from './events.js';
import { statementHtml, type FontFaces } from './statements.js';
import type { AssetCode } from '../shared/types.js';
import { ASSETS } from '../shared/assets.js';
import { deskAmount, deskHealthFactor, deskPrice } from '../shared/deskFormat.js';
import { healthFactorScaled } from './domain.js';

const RETRY_SECONDS = 10;

export interface Jobs {
  setFonts(fonts: FontFaces): void;
}

/** Deliver queued notices: attempted within 10 seconds, retried every 10 seconds. */
export async function deliverNotices(app: App): Promise<void> {
  const cfg = getConfig();
  const rows = await app.db.withClient(async (client): Promise<Array<{
    notice_id: string; position_id: string; kind: 'margin' | 'liquidation'; created_at: Date;
  }>> => {
    const result = await client.query(
      `SELECT notice_id, position_id, kind, created_at FROM notices
       WHERE status = 'queued' ORDER BY created_at LIMIT 20`,
    );
    return result.rows;
  });
  for (const notice of rows) {
    const info = await app.db.withClient(async (client): Promise<{
      borrower_id: string; email: string; collateral_asset: AssetCode; debt_asset: AssetCode;
      collateral_amount: string; posted_debt: string; round: string;
    } | null> => {
      const result = await client.query(
        `SELECT p.borrower_id, p.collateral_asset, p.debt_asset, p.collateral_amount, p.posted_debt, p.round,
                m.email FROM positions p JOIN members m ON m.actor_id = p.borrower_id WHERE p.position_id = $1`,
        [notice.position_id],
      );
      return result.rows[0] ?? null;
    });
    if (info === null) continue;
    const prices = await app.db.withClient(async (client): Promise<{ c: bigint; d: bigint; t: number } | null> => {
      const result = await client.query(
        `SELECT
          (SELECT price FROM price_posts WHERE price_post_id = (SELECT price_post_id FROM current_prices WHERE asset = $1)) AS c,
          (SELECT price FROM price_posts WHERE price_post_id = (SELECT price_post_id FROM current_prices WHERE asset = $2)) AS d,
          (SELECT liquidation_threshold_bps FROM pools WHERE asset = $1) AS t`,
        [info.collateral_asset, info.debt_asset],
      );
      const row = result.rows[0];
      if (row === undefined || row.c === null || row.d === null || row.t === null) return null;
      return { c: BigInt(row.c), d: BigInt(row.d), t: Number(row.t) };
    });
    if (prices === null) continue;
    const debt = BigInt(info.posted_debt);
    const collateral = BigInt(info.collateral_amount);
    const hf = healthFactorScaled({
      collateralAsset: info.collateral_asset,
      debtAsset: info.debt_asset,
      collateral_amount: collateral,
      collateral_price: prices.c,
      debt,
      debt_price: prices.d,
      liquidation_threshold_bps: prices.t,
    });
    try {
      if (notice.kind === 'margin') {
        const liquidationPrice = debt === 0n ? null : null;
        await sendMail(
          info.email,
          marginSubject({
            position_id: notice.position_id,
            borrower_email: info.email,
            health_factor: hf,
            debt,
            debt_asset: info.debt_asset,
            collateral,
            collateral_asset: info.collateral_asset,
            liquidation_price: liquidationPrice,
          }),
          marginBody({
            position_id: notice.position_id,
            borrower_email: info.email,
            health_factor: hf,
            debt,
            debt_asset: info.debt_asset,
            collateral,
            collateral_asset: info.collateral_asset,
            liquidation_price: liquidationPrice,
          }),
        );
      } else {
        const extra = await app.db.withClient(async (client): Promise<Record<string, unknown> | null> => {
          const result = await client.query<{ extra: Record<string, unknown>; settlement_id: string; created_at: Date }>(
            'SELECT extra, settlement_id, created_at FROM settlements WHERE notice_id = $1', [notice.notice_id],
          );
          if (result.rows.length === 0) return null;
          return { ...result.rows[0].extra, settlement_id: result.rows[0].settlement_id };
        });
        if (extra === null) continue;
        const hfAfterRaw = extra.health_factor_after;
        const hfAfter = typeof hfAfterRaw === 'string' ? deskHfScaled(hfAfterRaw) : null;
        await sendMail(
          info.email,
          liquidationSubject({
            position_id: notice.position_id,
            borrower_email: info.email,
            round: BigInt(String(extra.round ?? '0')),
            repaid: BigInt(String(extra.repaid ?? '0')),
            seized: BigInt(String(extra.seized ?? '0')),
            bonus_amount: BigInt(String(extra.bonus_amount ?? '0')),
            health_factor_after: hfAfter,
            settlement_id: String(extra.settlement_id ?? ''),
            debt_asset: info.debt_asset,
            collateral_asset: info.collateral_asset,
          }),
          liquidationBody({
            position_id: notice.position_id,
            borrower_email: info.email,
            round: BigInt(String(extra.round ?? '0')),
            repaid: BigInt(String(extra.repaid ?? '0')),
            seized: BigInt(String(extra.seized ?? '0')),
            bonus_amount: BigInt(String(extra.bonus_amount ?? '0')),
            health_factor_after: hfAfter,
            settlement_id: String(extra.settlement_id ?? ''),
            debt_asset: info.debt_asset,
            collateral_asset: info.collateral_asset,
          }),
        );
      }
      await app.db.withClient(async (client): Promise<void> => {
        await client.query("UPDATE notices SET status = 'sent', sent_at = now() WHERE notice_id = $1", [notice.notice_id]);
      });
    } catch {
      await app.db.withClient(async (client): Promise<void> => {
        await client.query('UPDATE notices SET sent_at = NULL WHERE notice_id = $1', [notice.notice_id]);
      }).catch((): void => undefined);
    }
  }
  void cfg;
}

/** A health factor string from the API back to its scaled-by-10^4 form for desk rendering. */
function deskHfScaled(apiValue: string): bigint {
  const [whole, frac = ''] = apiValue.split('.');
  return BigInt(whole + frac.padEnd(4, '0'));
}

/** Render queued PDFs, claimed per row so every process renders each one exactly once. */
export async function renderPdfs(app: App, fonts: FontFaces): Promise<void> {
  const cfg = getConfig();
  const claims = await app.db.transaction(async (tx): Promise<Array<{ settlement_id: string }>> => {
    await tx.query(
      `UPDATE render_queue SET status = 'pending', claimed_by = NULL
       WHERE status = 'rendering' AND claimed_until < now()`,
    );
    const rows = await tx.query<{ id: string; settlement_id: string }>(
      `SELECT id, settlement_id FROM render_queue
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED`,
    );
    const worker = `worker-${process.pid}-${randomHex()}`;
    for (const row of rows.rows) {
      await tx.query(
        `UPDATE render_queue SET status = 'rendering', claimed_by = $1, claimed_until = now() + interval '30 seconds' WHERE id = $2`,
        [worker, row.id],
      );
    }
    return rows.rows.map((row): { settlement_id: string } => ({ settlement_id: row.settlement_id }));
  }).catch((): Array<{ settlement_id: string }> => []);
  for (const claim of claims) {
    await renderOne(app, claim.settlement_id, fonts);
  }
  void cfg;
}

function randomHex(): string {
  return Math.random().toString(16).slice(2, 8);
}

async function renderOne(app: App, settlementId: string, fonts: FontFaces): Promise<void> {
  const cfg = getConfig();
  const row = await app.db.withClient(async (client): Promise<{
    kind: string; actor_id: string; position_id: string | null; asset: AssetCode; amount: string;
    statement_key: string; pdf_key: string; extra: Record<string, unknown>; created_at: Date;
    legs: Array<{ account: string; asset: AssetCode; amount: string }>;
  } | null> => {
    const settlement = await client.query(
      'SELECT settlement_id, kind, actor_id, position_id, asset, amount, statement_key, pdf_key, extra, created_at FROM settlements WHERE settlement_id = $1',
      [settlementId],
    );
    if (settlement.rows.length === 0) return null;
    const s = settlement.rows[0];
    const member = await client.query<{ name: string }>('SELECT name FROM members WHERE actor_id = $1', [s.actor_id]);
    const legs = await client.query<{ account: string; asset: AssetCode; amount: string }>(
      `SELECT l.account, l.asset, l.amount::text AS amount FROM legs l
       JOIN postings p ON p.posting_id = l.posting_id WHERE p.ref = $1 ORDER BY l.posting_id, l.seq`,
      [settlementId],
    );
    return {
      kind: s.kind,
      actor_id: s.actor_id,
      position_id: s.position_id,
      asset: s.asset,
      amount: s.amount,
      statement_key: s.statement_key,
      pdf_key: s.pdf_key,
      extra: (s.extra ?? {}) as Record<string, unknown>,
      created_at: s.created_at,
      legs: legs.rows,
    };
  });
  if (row === null) return;
  const name = await app.db.withClient(async (client): Promise<string> => {
    const member = await client.query<{ name: string }>('SELECT name FROM members WHERE actor_id = $1', [row.actor_id]);
    return member.rows[0]?.name ?? row.actor_id;
  });
  const input = {
    settlement_id: settlementId,
    kind: row.kind as 'draw' | 'withdrawal' | 'liquidation',
    actor_id: row.actor_id,
    actor_name: name,
    position_id: row.position_id,
    asset: row.asset,
    amount: BigInt(row.amount),
    legs: row.legs,
    created_at: new Date(Math.floor(row.created_at.getTime() / 1000) * 1000),
    liquidation: row.kind === 'liquidation'
      ? {
        repaid: BigInt(String(row.extra.repaid ?? '0')),
        seized: BigInt(String(row.extra.seized ?? '0')),
        bonus_amount: BigInt(String(row.extra.bonus_amount ?? '0')),
        written_off: BigInt(String(row.extra.written_off ?? '0')),
        health_factor_before: null as bigint | null,
        health_factor_after: null as bigint | null,
        collateral_asset: 'QUSD' as AssetCode,
        debt_asset: 'QUSD' as AssetCode,
      }
      : undefined,
  };
  const html = statementHtml(input, cfg.deskTimeZone, fonts);
  const boundary = `----q${randomHex()}${randomHex()}`;
  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: text/html\r\n\r\n`),
    Buffer.from(html, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ];
  let pdfResponse: Response | null = null;
  try {
    pdfResponse = await fetch(`${cfg.gotenbergUrl.replace(/\/$/, '')}/forms/chromium/convert/html`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.concat(parts),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    console.error('gotenberg render failed:', (err as Error).message);
    pdfResponse = null;
  }
  if (pdfResponse === null || !pdfResponse.ok) {
    if (pdfResponse !== null) {
      const text = await pdfResponse.text().catch((): string => '');
      console.error(`gotenberg returned ${pdfResponse.status}: ${text.slice(0, 300)}`);
    }
    await failRender(app, settlementId);
    return;
  }
  const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
  try {
    await app.store.ensureBucket();
    await app.store.putOnce(row.pdf_key, bytes, 'application/pdf');
  } catch (err) {
    console.error('pdf store failed:', (err as Error).message);
    await failRender(app, settlementId);
    return;
  }
  await app.db.withClient(async (client): Promise<void> => {
    await client.query('UPDATE settlements SET pdf_rendered_at = now() WHERE settlement_id = $1', [settlementId]);
    await client.query("UPDATE render_queue SET status = 'done', completed_at = now() WHERE settlement_id = $1", [settlementId]);
  }).catch((): void => undefined);
}

/** Put a render back on the queue for the next attempt. */
async function failRender(app: App, settlementId: string): Promise<void> {
  await app.db.withClient(async (client): Promise<void> => {
    await client.query(
      `UPDATE render_queue SET status = 'pending', attempts = attempts + 1, next_attempt_at = now() + ($1 || ' seconds')::interval WHERE settlement_id = $2`,
      [String(RETRY_SECONDS), settlementId],
    );
  }).catch((): void => undefined);
}

/** Deliver queued webhooks in sequence order per position. */
export async function deliverWebhooks(app: App): Promise<void> {
  const events = await app.db.transaction(async (tx): Promise<Array<{ event_id: string; payload: unknown }>> => {
    const ready = await claimReadyEvents(tx, 20);
    return ready.map((event): { event_id: string; payload: unknown } => ({ event_id: event.event_id, payload: event.payload }));
  }).catch((): Array<{ event_id: string; payload: unknown }> => []);
  for (const event of events) {
    const payload = event.payload as { event_id: string; type: string; position_id: string | null; sequence: number | null; occurred_at: string; data: unknown };
    try {
      await deliverEvent({
        event_id: payload.event_id,
        type: payload.type as 'settlement.committed' | 'position.state_changed',
        position_id: payload.position_id,
        sequence: payload.sequence,
        occurred_at: payload.occurred_at,
        data: payload.data as SettlementEventData | PositionEventData,
      });
      await app.db.withClient(async (client): Promise<void> => {
        await client.query("UPDATE events SET status = 'delivered', delivered_at = now() WHERE event_id = $1", [event.event_id]);
      });
    } catch {
      await app.db.withClient(async (client): Promise<void> => {
        await client.query(
          `UPDATE events SET attempts = attempts + 1, next_attempt_at = now() + ($1 || ' seconds')::interval WHERE event_id = $2`,
          [String(RETRY_SECONDS), event.event_id],
        );
      }).catch((): void => undefined);
      return;
    }
  }
}

/** Background accrual and position evaluation with no request involved. */
export async function evaluateInBackground(app: App): Promise<void> {
  await app.db.transaction(async (tx): Promise<void> => {
    await refreshAndEvaluate(tx, new Date(Math.floor(Date.now() / 1000) * 1000));
  }).catch((): void => undefined);
}

export function startJobs(app: App, fonts: FontFaces): NodeJS.Timeout {
  const interval = setInterval((): void => {
    void deliverNotices(app).catch((): void => undefined);
    void renderPdfs(app, fonts).catch((): void => undefined);
    void deliverWebhooks(app).catch((): void => undefined);
    void evaluateInBackground(app).catch((): void => undefined);
  }, 5_000);
  return interval;
}
