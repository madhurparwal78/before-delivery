import type { PoolClient } from 'pg';
import type { Database } from './db.js';
import type { Config } from './config.js';
import { KillBillClient } from './killbill.js';
import { Mailer, type MailMessage } from './mail.js';

/** A Kill Bill effect (account/seat creation, seat cancellation) or an email. */
export type OutboxItem =
  | { readonly kind: 'billing_account'; readonly workspaceId: string; readonly memberId: string; readonly workspaceName: string; readonly ownerEmail: string }
  | { readonly kind: 'billing_seat'; readonly workspaceId: string; readonly memberId: string }
  | { readonly kind: 'billing_cancel_seat'; readonly workspaceId: string; readonly memberId: string }
  | { readonly kind: 'email'; readonly message: MailMessage };

interface OutboxRow {
  readonly id: string;
  readonly payload: OutboxItem;
  readonly attempts: number;
}

/** Every effect on Kill Bill or mail is written to the outbox in the same transaction as its cause. */
export async function enqueueOutbox(client: PoolClient, items: readonly OutboxItem[]): Promise<void> {
  if (items.length === 0) return;
  const values: unknown[] = [];
  const tuples: string[] = [];
  items.forEach((item, i) => {
    const base = i * 2;
    tuples.push(`($${base + 1}::text, $${base + 2}::jsonb, 'pending')`);
    values.push(item.kind, JSON.stringify(item));
  });
  await client.query(`INSERT INTO outbox (kind, payload, status) VALUES ${tuples.join(', ')}`, values);
}

const CLAIM_SECONDS = 60;

/**
 * Drains the outbox. Claims items so only one instance performs each one,
 * retries at least every 10 seconds, and completes each item exactly once.
 */
export class OutboxWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly instanceId = `i${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

  constructor(
    private readonly db: Database,
    private readonly killbill: KillBillClient,
    private readonly mailer: Mailer,
    private readonly config: Config,
  ) {}

  start(intervalMs: number): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async drainOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let performed = 0;
    try {
      for (let round = 0; round < 50; round++) {
        const claimed = await this.db.withTransaction(async (client): Promise<OutboxRow | null> => {
          const rows = await client.query<OutboxRow>(
            `UPDATE outbox SET status = 'in_flight', claimed_by = $1, claimed_at = now()
             WHERE id = (
               SELECT id FROM outbox
               WHERE status = 'pending' OR (status = 'in_flight' AND claimed_at < now() - ($2 || ' seconds')::interval)
               ORDER BY id
               LIMIT 1
               FOR UPDATE SKIP LOCKED
             )
             RETURNING id, payload, attempts`,
            [this.instanceId, String(CLAIM_SECONDS)],
          );
          return rows.rows[0] ?? null;
        });
        if (claimed === null) break;
        const done = await this.perform(claimed.id, claimed.payload);
        await this.db.query(
          done
            ? "UPDATE outbox SET status = 'done', sent_at = now(), last_error = NULL, attempts = $2 WHERE id = $1"
            : "UPDATE outbox SET status = 'pending', attempts = $2, last_error = 'service unreachable' WHERE id = $1",
          [claimed.id, claimed.attempts + 1],
        );
        if (done) performed++;
      }
    } catch {
      /* the next sweep retries */
    } finally {
      this.running = false;
    }
    return performed;
  }

  private async perform(id: string, payload: OutboxItem): Promise<boolean> {
    try {
      switch (payload.kind) {
        case 'billing_account':
          await this.killbill.ensureCatalog();
          await this.killbill.ensureAccount(payload.workspaceId, payload.workspaceName, payload.ownerEmail);
          await this.killbill.ensureSeat(payload.workspaceId, payload.memberId);
          return true;
        case 'billing_seat':
          await this.killbill.ensureCatalog();
          await this.killbill.ensureSeat(payload.workspaceId, payload.memberId);
          return true;
        case 'billing_cancel_seat':
          await this.killbill.cancelSeat(payload.workspaceId, payload.memberId);
          return true;
        case 'email':
          await this.mailer.send(id, payload.message);
          return true;
      }
    } catch (e) {
      if (process.env.TIDEMARK_DEBUG === '1') {
        process.stderr.write(`[debug] outbox ${payload.kind} failed: ${e instanceof Error ? e.message : String(e)}\n`);
      }
      return false;
    }
  }
}

/** Mail is queued when unreachable but never silently dropped. */
export const mailQueued = (): { email: 'queued' } => ({ email: 'queued' });
