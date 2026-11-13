import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev' });
const res = await pool.query(process.argv[2] ?? 'SELECT 1');
console.log(JSON.stringify(res.rows, null, 2));
await pool.end();
