import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const a = await pool.query('SELECT id, name FROM workspaces');
console.log('workspaces:', a.rows.map(r => r.id).join(', '));
const m = await pool.query('SELECT id, name, role, status FROM members');
for (const r of m.rows) console.log(' member:', r.id, r.name, r.role, r.status);
const o = await pool.query('SELECT count(*)::int as c FROM outbox');
console.log('outbox count:', o.rows[0].c);
await pool.end();
