import pg from 'pg';
import { env } from './env.ts';
import type { AuditAction, AuditTargetType } from './domain/audit.ts';

export const AUDIT_CHANNEL = 'strata_audit';
export const SESSION_CHANNEL = 'strata_sessions';

export interface ActivityRow {
  seq: number;
  action: AuditAction;
  target: { type: AuditTargetType; id: string };
}

type ActivityHandler = (row: ActivityRow) => void;
type SessionHandler = (tokenHash: string) => void;

/** Fans committed rows out to this instance's open streams. */
class ActivityBus {
  private readonly activityHandlers = new Set<ActivityHandler>();
  private readonly sessionHandlers = new Set<SessionHandler>();

  onActivity(handler: ActivityHandler): () => void {
    this.activityHandlers.add(handler);
    return () => this.activityHandlers.delete(handler);
  }

  onSessionEnded(handler: SessionHandler): () => void {
    this.sessionHandlers.add(handler);
    return () => this.sessionHandlers.delete(handler);
  }

  publishActivity(row: ActivityRow): void {
    for (const handler of [...this.activityHandlers]) handler(row);
  }

  publishSessionEnded(tokenHash: string): void {
    for (const handler of [...this.sessionHandlers]) handler(tokenHash);
  }
}

export const bus = new ActivityBus();

/** One dedicated connection per instance carries notifications from any instance. */
export function startNotificationListener(): void {
  const connect = (): void => {
    const client = new pg.Client({ connectionString: env.databaseUrl });
    client.on('notification', (message) => {
      if (message.channel === AUDIT_CHANNEL && message.payload) {
        bus.publishActivity(JSON.parse(message.payload) as ActivityRow);
      }
      if (message.channel === SESSION_CHANNEL && message.payload) {
        bus.publishSessionEnded(message.payload);
      }
    });
    client.on('error', () => {
      client.end().catch(() => undefined);
      setTimeout(connect, 1000);
    });
    client
      .connect()
      .then(async () => {
        await client.query(`LISTEN ${AUDIT_CHANNEL}`);
        await client.query(`LISTEN ${SESSION_CHANNEL}`);
      })
      .catch(() => {
        setTimeout(connect, 1000);
      });
  };
  connect();
}
