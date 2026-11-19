function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} is not a number`);
  return parsed;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  valkeyUrl: required('VALKEY_URL'),
  gotenbergUrl: required('GOTENBERG_URL'),
  publicPort: integer('APP_PUBLIC_PORT', 4173),
  sessionIdleSeconds: integer('SESSION_IDLE_SECONDS', 1800),
} as const;

export const INSTANCE_IDS = ['a', 'b'] as const;
export type InstanceId = (typeof INSTANCE_IDS)[number];

export const MAX_BODY_BYTES = 1_000_000;
export const TICK_MS = 1000;
export const LEASE_TTL_MS = 3000;
export const LEASE_TAKEOVER_MS = 5000;
export const STREAM_MAX_LEN = 2000;
export const PACKET_RENDER_TIMEOUT_MS = 20_000;
export const SERVICE_PROBE_MS = 5000;
