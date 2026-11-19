import type { Database } from './db.js';
import type { Config } from './config.js';
import { loadWorkspace, replayState, workspaceLock, type StateEventRow } from './subscriptions.js';
import { enqueueOutbox, type OutboxItem } from './outbox.js';
import { dayLabel, localTimeOf, isoInstant } from '../src-shared/domain.js';

/**
 * The background sweep: trial-end transitions and trial notices.
 * Runs at least every 10 seconds on every instance sharing the database.
 */
export class Sweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly config: Config,
  ) {}

  start(intervalMs: number): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.sweepOnce();
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  async sweepOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const workspaces = await this.db.query<{ id: string; name: string; state: string; trial_ends_at: string; trial_notice_sent_at: string | null }>(
        'SELECT id, name, state, trial_ends_at, trial_notice_sent_at FROM workspaces',
      );
      const now = new Date();
      const due: Array<{ id: string; memberId: string; name: string; endsAt: Date; timeZone: string; email: string }> = [];
      for (const ws of workspaces) {
        const lock = workspaceLock(ws.id);
        await this.db.withAdvisoryTransaction(lock, async (client) => {
          const events = await client.query<StateEventRow>('SELECT event_id, type, occurred_at FROM billing_events WHERE workspace_id = $1', [ws.id]);
          const state = replayState(events.rows, new Date(ws.trial_ends_at), now);
          if (state !== ws.state) {
            await client.query('UPDATE workspaces SET state = $1 WHERE id = $2', [state, ws.id]);
          }
          if (state === 'trialing' && ws.trial_notice_sent_at === null) {
            const leadMs = configLeadMs(this.config);
            const endsMs = new Date(ws.trial_ends_at).getTime();
            if (now.getTime() >= endsMs - leadMs) {
              const owner = await client.query<{ id: string; name: string; email: string; time_zone: string }>(
                "SELECT id, name, email, time_zone FROM members WHERE workspace_id = $1 AND role = 'owner' AND removed_at IS NULL LIMIT 1",
                [ws.id],
              );
              const o = owner.rows[0];
              if (o !== undefined) {
                const marked = await client.query('UPDATE workspaces SET trial_notice_sent_at = now() WHERE id = $1 AND trial_notice_sent_at IS NULL RETURNING id', [ws.id]);
                if (marked.rows.length > 0) {
                  due.push({ id: ws.id, memberId: o.id, name: ws.name, endsAt: new Date(ws.trial_ends_at), timeZone: o.time_zone, email: o.email });
                }
              }
            }
          }
        });
      }
      for (const notice of due) {
        await this.db.withTransaction(async (client) => {
          const outbox: OutboxItem[] = [
            {
              kind: 'email',
              message: {
                kind: 'trial_notice',
                to: notice.email,
                workspaceName: notice.name,
                trialEndLabel: dayLabel(isoInstant(notice.endsAt).slice(0, 10), notice.timeZone),
                trialEndTime: localTimeOf(notice.endsAt, notice.timeZone),
                timeZone: notice.timeZone,
              },
            },
          ];
          await enqueueOutbox(client, outbox);
        });
      }
    } catch {
      /* the next sweep retries */
    } finally {
      this.running = false;
    }
  }
}

const configLeadMs = (config: Config): number => config.timing.trialNoticeLeadSeconds * 1000;

/** Convenience wrapper used by the server at boot. */
export async function refreshWorkspaceStates(db: Database): Promise<void> {
  const sweeper = new Sweeper(db, loadConfigOrDefault());
  await sweeper.sweepOnce();
}

function loadConfigOrDefault(): Config {
  return loadConfigSafe();
}

import { loadConfig, type Config as Cfg } from './config.js';
function loadConfigSafe(): Cfg {
  try {
    return loadConfig();
  } catch {
    return {
      port: 4173,
      databaseUrl: '',
      killbill: { url: '', username: '', password: '', apiKey: '', apiSecret: '' },
      smtp: { host: '', port: 25, from: '' },
      timing: {
        trialLengthSeconds: 1_209_600,
        trialNoticeLeadSeconds: 259_200,
        billingCallbackToleranceSeconds: 300,
        idempotencyTtlSeconds: 86_400,
        sessionTtlSeconds: 2_592_000,
      },
    };
  }
}
