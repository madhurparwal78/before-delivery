// Configuration from environment (DP-83) plus the process-wide runtime state.
import pg from 'pg';
import { Clock } from '../domain/clock.ts';

export interface Env {
  databaseUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  appPort: number;
  appPublicUrl: string;
  appOrigin: string;
  clockStart?: string;
  raidFinalizeSeconds: number;
  shieldSeconds: number;
  targetCooldownSeconds: number;
  verifyTokenSeconds: number;
  resetTokenSeconds: number;
  sessionSeconds: number;
  buildTimeDivisor: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = value === undefined || value === '' ? fallback : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readEnv(): Env {
  const appPublicUrl = process.env.APP_PUBLIC_URL ?? 'http://localhost:4173';
  let appOrigin = appPublicUrl;
  try {
    appOrigin = new URL(appPublicUrl).origin;
  } catch {
    appOrigin = appPublicUrl.replace(/\/$/, '');
  }
  return {
    databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/saltreach',
    smtpHost: process.env.SMTP_HOST ?? 'localhost',
    smtpPort: int(process.env.SMTP_PORT, 1025),
    mailFrom: process.env.MAIL_FROM ?? 'Saltreach <tides@saltreach.lowtide.test>',
    appPort: int(process.env.APP_PUBLIC_PORT, 4173),
    appPublicUrl,
    appOrigin,
    clockStart: process.env.SALTREACH_CLOCK_START || undefined,
    raidFinalizeSeconds: int(process.env.RAID_FINALIZE_SECONDS, 300),
    shieldSeconds: int(process.env.SHIELD_SECONDS, 43200),
    targetCooldownSeconds: int(process.env.TARGET_COOLDOWN_SECONDS, 86400),
    verifyTokenSeconds: int(process.env.VERIFY_TOKEN_SECONDS, 86400),
    resetTokenSeconds: int(process.env.RESET_TOKEN_SECONDS, 1800),
    sessionSeconds: int(process.env.SESSION_SECONDS, 2592000),
    buildTimeDivisor: int(process.env.BUILD_TIME_DIVISOR, 1),
  };
}

const CONNECTION_SQLSTATES = new Set([
  '57P01', '57P02', '57P03', '53300', '08000', '08003', '08006', '08001', '08004', '08007',
]);

export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e?.code === 'string') {
    if (e.code.startsWith('E')) return true; // TCP errno codes (ECONNREFUSED, ETIMEDOUT, ...)
    if (CONNECTION_SQLSTATES.has(e.code)) return true;
  }
  return typeof e?.message === 'string' && /connect|connection|terminated|refused|timeout/i.test(e.message);
}

export interface App {
  env: Env;
  clock: Clock;
  pool: pg.Pool;
  dbUp: boolean;
  mailUp: boolean;
  booted: boolean;
}

let app: App | null = null;

export function setApp(a: App): void {
  app = a;
}

export function getApp(): App {
  if (app === null) throw new Error('runtime not started');
  return app;
}

export async function query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
  const a = getApp();
  try {
    const result = await a.pool.query<T>(text, params);
    a.dbUp = true;
    return result;
  } catch (err) {
    if (isConnectionError(err)) a.dbUp = false;
    throw err;
  }
}

// Runs fn inside a transaction; commits if it resolves, rolls back if it rejects.
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const a = getApp();
  const client = await a.pool.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection was already lost
    }
    throw err;
  } finally {
    client.release();
  }
}
