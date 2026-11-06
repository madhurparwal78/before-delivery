// Dev helper: wipes the dev database so seed and smoke tests can run fresh.
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query('DROP SCHEMA public CASCADE');
await pool.query('CREATE SCHEMA public');
await pool.end();
console.log('database reset');
