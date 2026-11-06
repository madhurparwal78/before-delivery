// Drops every Tallyroom table so the next boot applies the schema and seed afresh.
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const { rows } = await client.query(
  "select tablename from pg_tables where schemaname = 'public'",
);
if (rows.length > 0) {
  const names = rows.map((row) => `"${row.tablename}"`).join(', ');
  await client.query(`drop table if exists ${names} cascade`);
}
await client.query('drop sequence if exists message_ids');
console.log(`dropped ${rows.length} tables`);
await client.end();
