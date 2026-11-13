import { Pool } from 'pg';

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

// Wait for Postgres at boot, retrying every 2 seconds (Server boundary).
export async function waitForPostgres(): Promise<void> {
  for (;;) {
    try {
      await db.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
