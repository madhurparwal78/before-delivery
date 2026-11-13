// Brute-forces the 6-digit space to recover the last issued OTP in local smoke tests only.
import { Pool } from "pg";
import { createHash } from "node:crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const identifier = process.argv[2];
const res = identifier
  ? await pool.query("SELECT code_hash FROM pending_signins WHERE identifier = $1 ORDER BY issued_at DESC LIMIT 1", [identifier])
  : await pool.query("SELECT code_hash FROM pending_signins ORDER BY issued_at DESC LIMIT 1");
const hash = res.rows[0]?.code_hash;
if (!hash) { console.log("no pending"); process.exit(1); }
for (let i = 0; i < 1000000; i++) {
  const candidate = String(i).padStart(6, "0");
  if (createHash("sha256").update(candidate).digest("hex") === hash) {
    console.log(candidate);
    break;
  }
}
await pool.end();
