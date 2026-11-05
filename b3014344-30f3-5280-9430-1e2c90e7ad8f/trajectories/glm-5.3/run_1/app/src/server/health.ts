import { pool } from './db.js';
import { killbillHealthy } from './killbill.js';
import { storageHealthy } from './storage.js';
import { mailHealthy } from './mail.js';
import { cmsHealthy } from './cms.js';

export interface HealthState {
  status: 'ok';
  services: {
    postgres: 'up' | 'down';
    killbill: 'up' | 'down';
    minio: 'up' | 'down';
    mailpit: 'up' | 'down';
    pocketbase: 'up' | 'down';
  };
}

export async function health(): Promise<HealthState> {
  const [postgres, killbill, minio, mailpit, pocketbase] = await Promise.all([
    (async (): Promise<'up' | 'down'> => {
      try {
        await pool.query('SELECT 1');
        return 'up';
      } catch {
        return 'down';
      }
    })(),
    killbillHealthy().then((up): 'up' | 'down' => (up ? 'up' : 'down')),
    storageHealthy().then((up): 'up' | 'down' => (up ? 'up' : 'down')),
    mailHealthy().then((up): 'up' | 'down' => (up ? 'up' : 'down')),
    cmsHealthy().then((up): 'up' | 'down' => (up ? 'up' : 'down')),
  ]);
  return { status: 'ok', services: { postgres, killbill, minio, mailpit, pocketbase } };
}
