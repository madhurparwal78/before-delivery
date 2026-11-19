import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query('DROP SCHEMA public CASCADE');
await pool.query('CREATE SCHEMA public');
console.log('reset');
pool.end();
