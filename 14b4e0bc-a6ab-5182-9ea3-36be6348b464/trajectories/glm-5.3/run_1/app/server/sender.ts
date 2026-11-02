import type { Database } from './db';
import type { DbRow } from './querier';
import { loadCatalog } from './catalog';
import { derive } from './derived';
import { composeNotice, noticeTargets } from './notices';
import type { MailRelay } from './mail';

interface ClaimedNotice extends DbRow {
  id: string;
  event_id: string;
  asset: string;
  owner_id: string;
  message_id: string;
}

/**
 * The notice sender (DP-68): every instance tries every 5 seconds, claiming a
 * notice under a 30-second lease, so a notice queued by an instance that cannot
 * reach the relay goes out from any instance that can.
 */
export class NoticeSender {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly db: Database, private readonly mail: MailRelay) {}

  start(): void {
    if (this.timer) return;
    const tick = async (): Promise<void> => {
      if (this.running) return;
      this.running = true;
      try {
        await this.deliverOne();
      } catch {
        /* the next tick retries */
      } finally {
        this.running = false;
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), 5000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async deliverOne(): Promise<void> {
    const claimed = await this.db.transaction(async (tx) => {
      const rows = await tx.query<ClaimedNotice>(
        `UPDATE notices SET state = 'claimed', claim_expires_at = $1, attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM notices
           WHERE state = 'queued' OR (state = 'claimed' AND claim_expires_at <= $1)
           ORDER BY id LIMIT 5 FOR UPDATE SKIP LOCKED
         ) RETURNING id, event_id, asset, owner_id, message_id`,
        [Date.now() + 30_000]
      );
      return rows;
    });
    for (const notice of claimed) {
      try {
        const content = await this.buildNotice(notice);
        if (content) await this.mail.send(content);
        await this.db.query(`UPDATE notices SET state = 'sent', claim_expires_at = NULL WHERE id = $1`, [notice.id]);
      } catch {
        // A failed attempt releases the claim at once.
        await this.db.query(`UPDATE notices SET state = 'queued', claim_expires_at = NULL WHERE id = $1`, [notice.id]);
      }
    }
  }

  private async buildNotice(notice: ClaimedNotice): Promise<ReturnType<typeof composeNotice> | null> {
    const event = await this.db.queryOne<{ asset: string; reason: string; by: string }>(
      `SELECT asset, reason, by FROM deprecation_events WHERE id = $1`,
      [notice.event_id]
    );
    if (!event) return null;
    const owner = await this.db.queryOne<{ id: string; name: string; email: string }>(
      `SELECT id, name, email FROM users WHERE id = $1`,
      [notice.owner_id]
    );
    if (!owner) return null;
    const actor = await this.db.queryOne<{ name: string }>(`SELECT name FROM users WHERE id = $1`, [event.by]);
    const data = await loadCatalog(this.db, null);
    const d = derive(data);
    const targets = noticeTargets(data, d, notice.asset);
    const affected = targets.get(notice.owner_id) ?? [];
    const noticeId = notice.message_id.replace(/^<notice-/, '').replace(/@strata\.quarrystone\.test>$/, '');
    return composeNotice({
      noticeId,
      ownerName: owner.name,
      ownerEmail: owner.email,
      asset: notice.asset,
      reason: event.reason,
      actorName: actor?.name ?? '',
      affected,
    });
  }
}
