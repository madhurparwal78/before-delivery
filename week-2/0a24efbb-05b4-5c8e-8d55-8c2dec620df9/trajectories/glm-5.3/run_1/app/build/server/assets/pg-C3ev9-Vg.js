import pg from "pg";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 3e4,
  ssl: process.env.DATABASE_URL && /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL) && process.env.DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : void 0
});
async function query(sql, params) {
  const result = await pool.query(sql, params);
  return result.rows;
}
async function run(client, sql, params) {
  if (client) {
    const result = await client.query(sql, params);
    return result.rows;
  }
  return query(sql, params);
}
export {
  pool,
  query,
  run
};
