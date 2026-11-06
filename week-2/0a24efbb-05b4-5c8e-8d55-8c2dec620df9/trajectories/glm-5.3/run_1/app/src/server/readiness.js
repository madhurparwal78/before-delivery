import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../db/pg.js';
import { seedIfEmpty } from '../db/seed.js';
import { reconcileRealmAccounts } from './keycloak.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');

const state = {
  schema: false,
  seeded: false,
  realm: false,
};

const REQUIRED_TABLES = [
  'employer', 'person', 'attendance_day', 'leave_day', 'regularisation_request',
  'policy', 'audit_event', 'share_link', 'sign_in_attempt', 'desk_session',
];

export async function tick(fetchFn) {
  // schema
  if (!state.schema) {
    try {
      const existing = await pool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
      );
      const have = new Set(existing.rows.map((r) => r.table_name));
      if (REQUIRED_TABLES.every((t) => have.has(t))) {
        state.schema = true;
      } else {
        await pool.query(schemaSql);
        state.schema = true;
      }
    } catch {
      return state;
    }
  }
  // seed
  if (!state.seeded) {
    const client = await pool.connect().catch(() => null);
    if (client) {
      try {
        const seeded = await seedIfEmpty(client, new Date());
        const rows = await query('SELECT id FROM employer LIMIT 1');
        if (rows.length > 0) state.seeded = true;
      } catch {
        // retry on the next tick
      } finally {
        client.release();
      }
    }
  }
  // realm
  if (!state.realm) {
    try {
      state.realm = await reconcileRealmAccounts(fetchFn);
    } catch {
      state.realm = false;
    }
  }
  return state;
}

export function readiness() {
  return { ...state };
}

export function isReady() {
  return state.schema && state.seeded && state.realm;
}
