import { Pool } from "pg";
import { applyMigrations } from "../src/server/db.js";
import { seedIfEmpty } from "../src/server/seed.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await applyMigrations(pool);
await seedIfEmpty(pool);
const ws = await pool.query("SELECT id, name, time_zone FROM workspaces ORDER BY name");
console.log("workspaces:", ws.rows.map((r) => r.name));
const notes = await pool.query("SELECT title, text FROM notes WHERE workspace_id = $1 ORDER BY created_at", [ws.rows.find((r) => r.name === "Tallyrun")?.id]);
for (const n of notes.rows) console.log(`- ${n.title}: ${JSON.stringify(n.text)}`);
const f = await pool.query(`
  SELECT fe.name, fe.status, fe.effort, fe.confidence, fe.fits,
    (SELECT count(*) FROM insights i WHERE i.feature_id = fe.id) AS insights,
    sv.priority
  FROM features fe JOIN score_versions sv ON sv.feature_id = fe.id AND sv.version = 1
  WHERE fe.parent_feature_id IS NULL
  ORDER BY sv.priority DESC`);
for (const r of f.rows) console.log(r.name, "| status", r.status, "| effort", r.effort, "| conf", r.confidence, "| insights", r.insights, "| prio", r.priority, "| fits", r.fits);
await pool.end();
