/** Drops every Lightfall table so the next server start reapplies the schema and seed. */
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const TABLES = [
  "idempotency_records",
  "refunds",
  "order_lines",
  "orders",
  "quote_shares",
  "placements",
  "project_variant_ordinals",
  "project_lines",
  "project_collaborators",
  "projects",
  "favourites",
  "sessions",
  "trade_applications",
  "newsletter_subscriptions",
  "stock_movements",
  "variants",
  "products",
  "users",
];

await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE`);
console.log("database reset");
await pool.end();
