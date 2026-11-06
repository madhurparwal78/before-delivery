
import pg from "/app/node_modules/pg/lib/index.js";
import { scryptSync, randomBytes } from "node:crypto";

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query("TRUNCATE reservations, groups, waitlist, accounts, sessions, kb_payments, kb_invoices, kb_refunds, idempotency, certificates, documents, mail_queue RESTART IDENTITY CASCADE");
const { rows } = await pool.query("SELECT count(*)::int AS count FROM benches");
if (rows[0].count === 0) {
  for (const row of ["A", "B", "C", "D"]) {
    for (let n = 1; n <= 6; n++) {
      await pool.query("INSERT INTO benches (label, row, number) VALUES ($1, $2, $3)", [`${row}${n}`, row, n]);
    }
  }
}
const STAFF = [
  ["registrar", "Theo Vasquez-Hale", "registrar@opaline-institute.test", "bench-days-registrar-2027"],
  ["director", "Mara Okonkwo-Lindqvist", "director@opaline-institute.test", "bench-days-director-2027"],
  ["frontdesk", "Priya Anand-Sorensen", "frontdesk@opaline-institute.test", "bench-days-frontdesk-2027"],
];
for (const [role, name, email, password] of STAFF) {
  await pool.query(
    "INSERT INTO accounts (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (email) DO NOTHING",
    [`acc_${randomBytes(10).toString("hex")}`, name, email, hashPassword(password), role]
  );
}
console.log("reset");
await pool.end();


