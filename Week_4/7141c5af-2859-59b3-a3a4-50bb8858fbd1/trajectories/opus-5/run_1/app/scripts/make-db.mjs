// Prepares a verification copy's storage. The real deployment gives each copy
// its own database; here each copy gets its own schema in the same one, so the
// app code and its provider wiring are exercised unchanged. The schema is
// recreated, so every run starts from the published seed. Verification only.
import pg from 'pg';

const url = process.argv[2] ?? process.env.DATABASE_URL;
const schema = process.argv[3];
if (!schema) {
  console.error('usage: make-db.mjs <databaseUrl> <schema>');
  process.exit(2);
}

const quoted = `"${schema.replace(/"/g, '""')}"`;
const pool = new pg.Pool({ connectionString: url });
await pool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
await pool.query(`CREATE SCHEMA ${quoted}`);
await pool.end();
console.log(`schema ${schema} ready`);
