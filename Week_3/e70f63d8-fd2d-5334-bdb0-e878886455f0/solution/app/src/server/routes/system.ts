import { config, SERVICE_PING_MS } from '../config.js';
import { pool } from '../db/pool.js';
import { reply, route } from '../http/router.js';
import { pingMail } from '../services/smtp.js';
import { pingStorage } from '../services/s3.js';
import { pingValkey } from '../services/valkey.js';


const postgresUp = async (): Promise<boolean> => {
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), SERVICE_PING_MS)),
    ]);
    return true;
  } catch {
    return false;
  }
};

const word = (up: boolean): 'up' | 'down' => (up ? 'up' : 'down');

route('GET', '/api/health', { auth: false }, async () => reply(200, { status: 'ok' }));

route('GET', '/api/config', { auth: false }, async () =>
  reply(200, { live_delay_ms: config.liveDelayMs, tick_ms: config.tickMs, tick_stagger_ms: config.tickStaggerMs }));

route('GET', '/api/services', { auth: false }, async () => {
  const [postgres, valkey, minio, mailpit] = await Promise.all([postgresUp(), pingValkey(), pingStorage(), pingMail()]);
  return reply(200, { postgres: word(postgres), valkey: word(valkey), minio: word(minio), mailpit: word(mailpit) });
});
