// Saltreach server entry point: configuration, schema and seed, probes, mail delivery, serving.
import pg from 'pg';
import { readEnv, setApp, isConnectionError, getApp } from './runtime.ts';
import { Clock } from '../domain/clock.ts';
import { startServer } from './http.ts';
import { migrate, seed } from './schema.ts';
import { startMailLoops } from './mail.ts';
import './api_auth.ts';
import './api_village.ts';
import './api_raid.ts';
import './api_rewards.ts';
import './api_clan.ts';
import './api_ops.ts';

async function main(): Promise<void> {
  const env = readEnv();
  const clock = new Clock(env.clockStart);
  const pool = new pg.Pool({
    connectionString: env.databaseUrl,
    max: 20,
    connectionTimeoutMillis: 4000,
    idleTimeoutMillis: 30000,
  });
  setApp({ env, clock, pool, dbUp: false, mailUp: false, booted: true });

  // Try to apply schema and seed data before serving, but serve within the bound whatever the
  // state of the dependencies; the background loop retries until it succeeds.
  const boot = async (): Promise<boolean> => {
    try {
      const client = await pool.connect();
      try {
        await migrate(client);
        await seed(client);
        return true;
      } finally {
        client.release();
      }
    } catch (err) {
      if (isConnectionError(err)) setDbUp(false);
      return false;
    }
  };

  const setDbUp = (up: boolean): void => {
    getApp().dbUp = up;
  };

  await Promise.race([boot(), new Promise((resolve) => setTimeout(resolve, 8000))]).then((ok) => {
    if (ok === true) setDbUp(true);
  });

  setInterval(() => {
    void boot().then((ok) => {
      if (ok) setDbUp(true);
    });
  }, 5000);

  setInterval(() => {
    void pool
      .query('SELECT 1')
      .then(() => setDbUp(true))
      .catch((err: unknown) => {
        if (isConnectionError(err)) setDbUp(false);
      });
  }, 5000);

  startMailLoops();
  await startServer();
}

void main();
