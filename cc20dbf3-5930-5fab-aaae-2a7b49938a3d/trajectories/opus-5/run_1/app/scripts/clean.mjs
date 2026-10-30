/** Development helper: stop every copy, clear the database, the bucket and Mailpit. */
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import { emptyBucket } from './s3-dev.mjs';

for (const entry of await readdir('/proc')) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const commandLine = await readFile(`/proc/${entry}/cmdline`, 'utf8');
    if (commandLine.includes('dist/server/main.js')) process.kill(Number(entry), 'SIGKILL');
  } catch {
    /* the process exited while we looked */
  }
}

await new Promise((resolve) => setTimeout(resolve, 400));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(
  `select pg_terminate_backend(pid) from pg_stat_activity
   where datname = current_database() and pid <> pg_backend_pid()`,
);
await pool.query(`truncate table
  settlement, settlement_fix, ledger_entry, photo, loan, hold,
  idempotency_key, email_message, web_session cascade`);
await pool.end();

await emptyBucket();
await fetch(`${process.env.MAILPIT_URL ?? 'http://mailpit:8025'}/api/v1/messages`, { method: 'DELETE' });
console.log('cleaned');
