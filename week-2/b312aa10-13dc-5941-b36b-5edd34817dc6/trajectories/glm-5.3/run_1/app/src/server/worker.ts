import type { PoolClient } from 'pg';
import { getPool, withContentionRetry } from './db.js';
import type { RouteContext } from './pipeline.js';
import { sendMail } from './mail.js';
import { KillBillClient } from './kb.js';
import { checkExpiryNotices } from './routes/documents.js';
import { renderSanitationPdf, entryObject } from './routes/sanitation.js';
import { todayInZone } from './time.js';
import { applyLapses } from './booking.js';

/**
 * The outbox: pending Kill Bill, mail and storage work. Retried at least
 * every 10 seconds; each item is delivered exactly once.
 */
export class OutboxWorker {
  private readonly ctx: RouteContext;
  private timer: NodeJS.Timeout | null = null;

  constructor(ctx: RouteContext) {
    this.ctx = ctx;
  }

  start(): void {
    const tick = async (): Promise<void> => {
      await this.processPending().catch(() => undefined);
      await this.sweep().catch(() => undefined);
    };
    void tick();
    this.timer = setInterval(tick, 10_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async processPending(): Promise<void> {
    const jobs = await withContentionRetry(async (client) => {
      const rows = (await client.query<{ id: string; kind: string; payload: unknown }>(
        `SELECT id, kind, payload FROM outbox WHERE done=false AND next_attempt_at <= now() ORDER BY created_at LIMIT 50`,
      )).rows;
      // Claim the jobs so concurrent workers do not race.
      for (const row of rows) {
        await client.query(`UPDATE outbox SET attempts=attempts+1, next_attempt_at=now() + interval '15 seconds' WHERE id=$1`, [row.id]);
      }
      return rows;
    });
    for (const job of jobs) {
      await this.run(job.id, job.kind, job.payload as Record<string, unknown>).catch(() => undefined);
    }
  }

  private async run(id: string, kind: string, payload: Record<string, unknown>): Promise<void> {
    try {
      if (kind === 'mail') {
        await sendMail(this.ctx.config, { to: String(payload.to), subject: String(payload.subject), body: String(payload.body) });
      } else if (kind === 'kb_record') {
        await withContentionRetry(async (client) => {
          const { deliverKbItems } = await import('./routes/bookings.js');
          const itemIds = (payload.itemIds as string[]) ?? [];
          await deliverKbItems(client, this.ctx, itemIds, new Map());
        });
      } else if (kind === 'kb_account_name') {
        await withContentionRetry(async (client) => {
          const memberId = String(payload.memberId);
          const business = (await client.query<{ business_name: string }>(`SELECT business_name FROM members WHERE id=$1`, [memberId])).rows[0].business_name;
          const { ensureKbAccount } = await import('./routes/bookings.js');
          const account = await ensureKbAccount(client, this.ctx, memberId);
          await this.ctx.killbill.updateAccountName(account, KillBillClient.kbSafeName(business));
        });
      } else if (kind === 'sanitation_pdf') {
        await this.storeSanitationPdf(String(payload.kitchenId), String(payload.month), String(payload.timeZone));
      }
      await withContentionRetry(async (client) => {
        await client.query(`UPDATE outbox SET done=true WHERE id=$1`, [id]);
      });
    } catch {
      await withContentionRetry(async (client) => {
        await client.query(`UPDATE outbox SET next_attempt_at=now() + interval '10 seconds' WHERE id=$1`, [id]);
      }).catch(() => undefined);
    }
  }

  /** A PDF queued during an outage is rendered when the queue stores it. */
  private async storeSanitationPdf(kitchenId: string, month: string, timeZone: string): Promise<void> {
    const client = await getPool().connect();
    try {
      const entries = (await client.query<{ id: string; area: string; task: string; sanitizer_ppm: number | null; initials: string; notes: string; logged_at: Date; logged_by: string }>(
        `SELECT * FROM sanitation_entries WHERE kitchen_id=$1 AND to_char(logged_at AT TIME ZONE $2, 'YYYY-MM')=$3 ORDER BY logged_at`,
        [kitchenId, timeZone, month],
      )).rows;
      const pdf = renderSanitationPdf(month, entries.map((e) => entryObject(e, timeZone)));
      await this.ctx.storage.put(`kitchens/${kitchenId}/sanitation/${month}.pdf`, pdf, 'application/pdf');
      await client.query(`UPDATE sanitation_reports SET status='stored', stored_at=now() WHERE kitchen_id=$1 AND month=$2`, [kitchenId, month]);
    } finally {
      client.release();
    }
  }

  /** The background sweep: lapses, expiry notices and seed objects. */
  private async sweep(): Promise<void> {
    const instant = new Date();
    const rows = (await withContentionRetry(async (client) => {
      return (await client.query<{ id: string; time_zone: string; grace: number }>(
        `SELECT k.id AS id, k.time_zone AS time_zone, $1 AS grace FROM kitchens k`,
        [this.ctx.config.noShowGraceSeconds],
      )).rows;
    })) as { id: string; time_zone: string; grace: number }[];
    for (const kitchen of rows) {
      await withContentionRetry(async (client) => {
        const due = (await client.query<{ id: string }>(
          `SELECT id FROM bookings WHERE kitchen_id=$1 AND (
            (status='held' AND hold_expires_at <= $2) OR
            (status='confirmed' AND start_at + ($3 || ' seconds')::interval < $2)
          )`,
          [kitchen.id, instant, String(this.ctx.config.noShowGraceSeconds)],
        )).rows;
        for (const row of due) {
          await applyLapses(client, row.id, instant, this.ctx.config.noShowGraceSeconds);
        }
        await checkExpiryNotices(client, kitchen.id, null, kitchen.time_zone);
      }).catch(() => undefined);
    }
    await this.ensureSeedObjects().catch(() => undefined);
    await this.ensureKbAccounts().catch(() => undefined);
  }

  /** Seed document objects that could not be stored at first start. */
  private async ensureSeedObjects(): Promise<void> {
    const client = await getPool().connect();
    try {
      const pending = (await client.query<{ document_id: string }>(`SELECT document_id FROM seed_objects_pending`)).rows;
      for (const row of pending) {
        const doc = (await client.query<{ id: string; kitchen_id: string; member_id: string; file_name: string; size_bytes: number }>(
          `SELECT id, kitchen_id, member_id, file_name, size_bytes FROM documents WHERE id=$1`,
          [row.document_id],
        )).rows[0];
        if (!doc) continue;
        const { seedPdfBytes } = await import('./seed.js');
        const bytes = seedPdfBytes(doc.member_id, doc.file_name);
        try {
          await this.ctx.storage.put(`kitchens/${doc.kitchen_id}/members/${doc.member_id}/documents/${doc.id}`, bytes, 'application/pdf');
          await client.query(`DELETE FROM seed_objects_pending WHERE document_id=$1`, [doc.id]);
        } catch {
          break;
        }
      }
    } finally {
      client.release();
    }
  }

  /** Kill Bill accounts that could not be created at start. */
  private async ensureKbAccounts(): Promise<void> {
    const client = await getPool().connect();
    try {
      const members = (await client.query<{ id: string; business_name: string }>(`SELECT id, business_name FROM members`)).rows;
      for (const member of members) {
        const existing = (await client.query<{ kb_account_id: string }>(`SELECT kb_account_id FROM kb_accounts WHERE member_id=$1`, [member.id])).rows[0];
        if (existing) continue;
        try {
          const account = await this.ctx.killbill.createAccount(member.id, KillBillClient.kbSafeName(member.business_name));
          await client.query(`INSERT INTO kb_accounts (member_id, kb_account_id) VALUES ($1,$2) ON CONFLICT (member_id) DO NOTHING`, [member.id, account]);
        } catch {
          break;
        }
      }
    } finally {
      client.release();
    }
  }
}

/** Seed objects and accounts also get a first attempt at start. */
export async function initialSeedWork(ctx: RouteContext): Promise<void> {
  const client = await getPool().connect();
  try {
    // Store seed document objects when storage is reachable at start.
    const pending = (await client.query<{ document_id: string }>(`SELECT document_id FROM seed_objects_pending`)).rows;
    for (const row of pending) {
      const doc = (await client.query<{ id: string; kitchen_id: string; member_id: string; file_name: string }>(
        `SELECT id, kitchen_id, member_id, file_name FROM documents WHERE id=$1`,
        [row.document_id],
      )).rows[0];
      if (!doc) continue;
      const { seedPdfBytes } = await import('./seed.js');
      const bytes = seedPdfBytes(doc.member_id, doc.file_name);
      try {
        await ctx.storage.put(`kitchens/${doc.kitchen_id}/members/${doc.member_id}/documents/${doc.id}`, bytes, 'application/pdf');
        await client.query(`DELETE FROM seed_objects_pending WHERE document_id=$1`, [doc.id]);
      } catch {
        break;
      }
    }
    // Create Kill Bill accounts for members when billing is reachable.
    const members = (await client.query<{ id: string; business_name: string }>(`SELECT id, business_name FROM members`)).rows;
    for (const member of members) {
      const existing = (await client.query<{ kb_account_id: string }>(`SELECT kb_account_id FROM kb_accounts WHERE member_id=$1`, [member.id])).rows[0];
      if (existing) continue;
      try {
        const account = await ctx.killbill.createAccount(member.id, KillBillClient.kbSafeName(member.business_name));
        await client.query(`INSERT INTO kb_accounts (member_id, kb_account_id) VALUES ($1,$2) ON CONFLICT (member_id) DO NOTHING`, [member.id, account]);
      } catch {
        break;
      }
    }
    // Expiry notices at start, only for current documents with no notice sent.
    const kitchens = (await client.query<{ id: string; time_zone: string }>(`SELECT id, time_zone FROM kitchens`)).rows;
    for (const kitchen of kitchens) {
      await checkExpiryNotices(client, kitchen.id, null, kitchen.time_zone).catch(() => undefined);
    }
    void todayInZone;
  } finally {
    client.release();
  }
}
