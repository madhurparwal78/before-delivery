// The four providers (Postgres, MinIO, Mailpit, Valkey): boot-tolerant connection state, retry loops and GET /api/health.
import { migrate, pool } from './db.ts';
import { registerRoute } from './http.ts';
import { checkStorage } from './s3.ts';
import { checkSmtp } from './smtp.ts';
import { checkValkey } from './valkey.ts';

export type ProviderName = 'postgres' | 'minio' | 'mailpit' | 'valkey';

const UP_INTERVAL_MS = 2000;
const DOWN_INTERVAL_MS = 1000;
const CHECK_TIMEOUT_MS = 4000;
const FIRST_ROUND_WAIT_MS = 5000;

const state: Record<ProviderName, boolean> = { postgres: false, minio: false, mailpit: false, valkey: false };
const listeners: ((name: ProviderName, up: boolean) => void)[] = [];
let schemaApplied = false;

async function checkPostgres(): Promise<void> {
  if (!schemaApplied) {
    await migrate();
    schemaApplied = true;
  }
  await pool.query('SELECT 1');
}

const checks: Record<ProviderName, () => Promise<void>> = {
  postgres: checkPostgres,
  minio: checkStorage,
  mailpit: checkSmtp,
  valkey: checkValkey,
};

export const providerUp = (name: ProviderName): boolean => state[name];

/** Called whenever a provider flips between up and down. */
export function onProviderChange(listener: (name: ProviderName, up: boolean) => void): void {
  listeners.push(listener);
}

async function probe(name: ProviderName): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([checks[name](), expired]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(name: ProviderName): Promise<void> {
  const up = await probe(name);
  if (up !== state[name]) {
    state[name] = up;
    process.stdout.write(`provider ${name} ${up ? 'up' : 'down'}\n`);
    for (const listener of listeners) listener(name, up);
  }
}

let firstRound: Promise<unknown> = Promise.resolve();
let stopped = false;

function loop(name: ProviderName): void {
  if (stopped) return;
  setTimeout(() => void refresh(name).finally(() => loop(name)), state[name] ? UP_INTERVAL_MS : DOWN_INTERVAL_MS);
}

export function startProviders(): void {
  const names = Object.keys(checks) as ProviderName[];
  firstRound = Promise.all(names.map((name) => refresh(name).finally(() => loop(name))));
}

export function stopProviders(): void {
  stopped = true;
}

export function registerHealthRoute(): void {
  registerRoute('GET', '/api/health', async () => {
    await Promise.race([firstRound, new Promise((resolve) => setTimeout(resolve, FIRST_ROUND_WAIT_MS))]);
    return { status: 200, body: { status: Object.values(state).every(Boolean) ? 'ok' : 'unavailable' } };
  }, { anonymous: true });
}
