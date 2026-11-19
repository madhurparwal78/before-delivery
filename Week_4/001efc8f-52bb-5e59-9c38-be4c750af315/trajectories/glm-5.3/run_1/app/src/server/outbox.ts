import type { AppClock } from './app-clock';
import type { Config } from './config';
import type { Db } from './db';
import { Mail, type MailMessage } from './mail';
import { formatLocalDateTime } from './datetime';

export type LedgerKind = 'invite' | 'digest';

interface LedgerRow {
  id: string;
  kind: string;
  key: string;
  payload: Record<string, unknown>;
  state: string;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  sent_at: Date | null;
}

/**
 * Email bookkeeping in PostgreSQL: every outgoing email is recorded in
 * mail_ledger and retried every 30 seconds until mail accepts it.
 */
export class Outbox {
  constructor(
    private readonly db: Db,
    private readonly clock: AppClock,
    private readonly mail: Mail,
    private readonly config: Config,
  ) {}

  async trySend(kind: LedgerKind, key: string, build: (when: Date) => MailMessage): Promise<boolean> {
    await this.db.pool.query(
      `INSERT INTO mail_ledger (kind, key, payload, state, attempts, created_at)
       VALUES ($1, $2, $3, 'pending', 0, $4)
       ON CONFLICT (kind, key) DO NOTHING`,
      [kind, key, JSON.stringify({}), this.clock.now()],
    );
    return this.attempt(kind, key, build);
  }

  /** Records first, then tries once. Returns true when mail accepted it. */
  async enqueueAndTry(kind: LedgerKind, key: string, payload: Record<string, unknown>, build: (when: Date) => MailMessage): Promise<boolean> {
    const inserted = await this.db.pool.query(
      `INSERT INTO mail_ledger (kind, key, payload, state, attempts, created_at)
       VALUES ($1, $2, $3, 'pending', 0, $4)
       ON CONFLICT (kind, key) DO NOTHING`,
      [kind, key, JSON.stringify(payload), this.clock.now()],
    );
    if (inserted.rowCount === 0) {
      // Already enqueued; report as queued unless it was sent.
      const existing = await this.db.pool.query('SELECT state FROM mail_ledger WHERE kind = $1 AND key = $2', [kind, key]);
      if (existing.rows[0]?.state === 'sent') return true;
      return false;
    }
    return this.attempt(kind, key, build);
  }

  async attempt(kind: LedgerKind, key: string, build: (when: Date) => MailMessage): Promise<boolean> {
    const when = this.clock.now();
    try {
      await this.mail.send(build(when), this.config.smtp.from);
      await this.db.pool.query(
        `UPDATE mail_ledger SET state = 'sent', sent_at = $3, attempts = attempts + 1, last_error = NULL
          WHERE kind = $1 AND key = $2`,
        [kind, key, when],
      );
      return true;
    } catch (err) {
      this.mail.setAvailable(false);
      await this.db.pool.query(
        `UPDATE mail_ledger SET state = 'pending', attempts = attempts + 1, last_error = $3
          WHERE kind = $1 AND key = $2`,
        [kind, key, err instanceof Error ? err.message : String(err)],
      );
      return false;
    }
  }

  /** Retries every pending email; called every 30 seconds. */
  async retryPending(): Promise<void> {
    const res = await this.db.pool.query<LedgerRow>(
      `SELECT id, kind, key, payload, state, attempts, last_error, created_at, sent_at
         FROM mail_ledger WHERE state = 'pending' ORDER BY id`,
    );
    for (const row of res.rows) {
      if (row.kind === 'invite') {
        const payload = row.payload as unknown as InvitePayload;
        const built = buildInviteMail(this.config, payload);
        await this.attempt('invite', row.key, () => built);
      }
    }
  }

  /** True when the invite email for this key has already been accepted by mail. */
  async wasSent(kind: LedgerKind, key: string): Promise<boolean> {
    const res = await this.db.pool.query(
      'SELECT state FROM mail_ledger WHERE kind = $1 AND key = $2',
      [kind, key],
    );
    return res.rows[0]?.state === 'sent';
  }

  /** Marks digests sent so a person never gets two digests for the same period. */
  async markDigestSent(userId: string, periodKey: string): Promise<void> {
    await this.db.pool.query(
      'INSERT INTO digest_periods (user_id, period_key, handled_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [userId, periodKey, this.clock.now()],
    );
  }

  async hasDigestPeriod(userId: string, periodKey: string): Promise<boolean> {
    const res = await this.db.pool.query(
      'SELECT 1 FROM digest_periods WHERE user_id = $1 AND period_key = $2',
      [userId, periodKey],
    );
    return res.rowCount !== null && res.rowCount > 0;
  }
}

export interface InvitePayload {
  email: string;
  name: string;
  workspaceName: string;
  inviteUrl: string;
  inviterName: string;
}

export function buildInviteMail(config: Config, payload: InvitePayload): MailMessage {
  return {
    to: payload.email,
    toName: payload.name,
    subject: `Join ${payload.workspaceName} on Rimewire`,
    body: [
      `Hello ${payload.name},`,
      '',
      `${payload.inviterName} has invited you to join ${payload.workspaceName} on Rimewire.`,
      '',
      `Set your password and join here: ${payload.inviteUrl}`,
      '',
      'Rimewire — the team messenger for refrigeration and HVAC crews.',
    ].join('\n'),
    date: new Date(),
  };
}

