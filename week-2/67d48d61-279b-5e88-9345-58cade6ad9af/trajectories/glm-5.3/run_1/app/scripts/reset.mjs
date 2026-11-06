/** Test reset: drops Promptside state so the next server start re-seeds. */
import pg from "pg";
const { Client } = pg;

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query("drop table if exists tasks, links, activity, journal, undo_journal, idempotency, attachments, meta cascade");
await db.end();

const r = await fetch(`${process.env.POCKETBASE_URL}/api/admins/auth-with-password`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ identity: process.env.POCKETBASE_ADMIN_EMAIL, password: process.env.POCKETBASE_ADMIN_PASSWORD }),
});
const { token } = await r.json();
await fetch(`${process.env.POCKETBASE_URL}/api/collections/requests`, {
  method: "DELETE", headers: { authorization: token },
});
console.log("reset done");
