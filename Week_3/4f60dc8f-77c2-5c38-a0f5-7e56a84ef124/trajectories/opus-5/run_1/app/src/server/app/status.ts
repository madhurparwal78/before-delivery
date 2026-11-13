import type { StatusView } from '../../shared/domain.js';
import { billingUp } from '../services/killbill.js';
import { storageUp } from '../services/storage.js';
import { emailUp } from '../services/mail.js';
import { measuringUp } from '../services/measure-queue.js';
import { documentsUp } from '../services/documents.js';
import { contentUp } from '../services/pocketbase.js';
import { searchUp } from '../services/search.js';
import { pushUp } from '../services/push.js';
import { query } from '../db/pool.js';

export type ServiceHealth = {
  postgres: boolean;
  killbill: boolean;
  minio: boolean;
  mailpit: boolean;
  pocketbase: boolean;
  rabbitmq: boolean;
  gotenberg: boolean;
  meilisearch: boolean;
  ntfy: boolean;
};

const postgresUp = async (): Promise<boolean> => {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

const FRESH_MS = 5_000;

let cached: { at: number; health: ServiceHealth } | null = null;
let inFlight: Promise<ServiceHealth> | null = null;

const probe = async (): Promise<ServiceHealth> => {
  const [postgres, killbill, minio, mailpit, pocketbase, rabbitmq, gotenberg, meilisearch, ntfy] =
    await Promise.all([
      postgresUp(),
      billingUp(),
      storageUp(),
      emailUp(),
      contentUp(),
      measuringUp(),
      documentsUp(),
      searchUp(),
      pushUp(),
    ]);
  return { postgres, killbill, minio, mailpit, pocketbase, rabbitmq, gotenberg, meilisearch, ntfy };
};

export const serviceHealth = async (): Promise<ServiceHealth> => {
  if (cached !== null && Date.now() - cached.at < FRESH_MS) return cached.health;
  if (inFlight === null)
    inFlight = probe()
      .then((health) => {
        cached = { at: Date.now(), health };
        return health;
      })
      .finally(() => {
        inFlight = null;
      });
  return inFlight;
};

const word = (up: boolean): 'up' | 'down' => (up ? 'up' : 'down');

export const statusView = async (): Promise<StatusView> => {
  const health = await serviceHealth();
  return {
    billing: word(health.killbill),
    storage: word(health.minio),
    email: word(health.mailpit),
    measuring: word(health.rabbitmq),
    documents: word(health.gotenberg),
  };
};

export const healthView = async (): Promise<Record<keyof ServiceHealth, 'up' | 'down'>> => {
  const health = await serviceHealth();
  return {
    postgres: word(health.postgres),
    killbill: word(health.killbill),
    minio: word(health.minio),
    mailpit: word(health.mailpit),
    pocketbase: word(health.pocketbase),
    rabbitmq: word(health.rabbitmq),
    gotenberg: word(health.gotenberg),
    meilisearch: word(health.meilisearch),
    ntfy: word(health.ntfy),
  };
};
