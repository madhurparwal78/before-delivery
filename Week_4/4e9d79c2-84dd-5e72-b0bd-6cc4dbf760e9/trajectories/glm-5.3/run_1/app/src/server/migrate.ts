import pg from "pg";

export async function applySchema(pool: pg.Pool): Promise<void> {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto").catch(() => {});
  const schema = (await import("./schema.js")).SCHEMA_SQL;
  await pool.query(schema);
}
