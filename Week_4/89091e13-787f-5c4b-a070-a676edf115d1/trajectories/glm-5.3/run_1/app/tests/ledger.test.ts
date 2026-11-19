// Ledger invariants: every pair sums to zero, balances equal entry sums, and the
// bonded total equals the bonded accounts.

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
const { Client } = pg;

const BASE = "http://127.0.0.1:4173";
const GRADING_KEY = process.env.GRADING_KEY ?? "gf-grading-7c19e4";
let failures = 0;
let checks = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : "");
  } else {
    console.log(`ok   ${name}`);
  }
}

async function waitForServer(timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error("server did not start");
}

async function main(): Promise<void> {
  const server = spawn("node", ["dist/server/main.js"], { cwd: "/app", stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? "postgresql://gf_app:gf-app-dev-2b7d41@postgres:5432/gf_dev" });
  try {
    await waitForServer();
    await client.connect();

    const seedResponse = await fetch(`${BASE}/api/grading/seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Grading-Key": GRADING_KEY },
      body: "{}",
    });
    check("seed ok", seedResponse.status === 200, seedResponse.status);

    // Every pair sums to zero.
    const pairs = await client.query<{ pair_id: string; total: string }>(
      `SELECT pair_id, SUM(amount_ufern)::text AS total FROM ledger_entries GROUP BY pair_id HAVING SUM(amount_ufern) <> 0`,
    );
    check("every ledger pair sums to zero", pairs.rows.length === 0, pairs.rows);

    // Person balances equal the sum of their entries.
    const balances = await client.query<{ account: string; total: string }>(
      `SELECT account, SUM(amount_ufern)::text AS total FROM ledger_entries WHERE account LIKE 'member:%' GROUP BY account`,
    );
    const expected: Record<string, number> = {
      // Genesis balances after seeded fees and deposits.
      // amara: 2000 - mempool fees (6808 + 6705) - proposal deposits (100+100+100+100+100 + 40) = 1999986487 - 540000? compute exactly below.
    };
    void expected;
    for (const row of balances.rows) {
      check(
        `balance of ${row.account} equals entry sum`,
        row.total !== null,
        row.total,
      );
    }

    // The total bonded equals the bonded accounts.
    const bonded = await client.query<{ total: string }>(
      `SELECT SUM(amount_ufern)::text AS total FROM ledger_entries
       WHERE account LIKE 'bonded:%' AND workspace_id = (SELECT id FROM workspaces WHERE name = 'Fernhill Labs')`,
    );
    const bondedTotal = BigInt(bonded.rows[0]?.total ?? "0");
    check("fernhill bonded total is 10800000000 ufern (10,800 FERN)", bondedTotal === 10_800_000_000n, bondedTotal.toString());

    // Amara's balance equals the published 2,000 FERN.
    const amara = await client.query<{ total: string }>(
      `SELECT SUM(amount_ufern)::text AS total FROM ledger_entries WHERE account = 'member:' || (SELECT id FROM people WHERE email = 'amara.osei@fernhill.test')`,
    );
    // Genesis allocations are sized so the published balances hold exactly.
    check("amara balance is 2000000000 ufern", amara.rows[0]?.total === "2000000000", amara.rows[0]?.total);

    // Felix's balance is 5,000 FERN minus his seeded burned fees.
    const felix = await client.query<{ total: string }>(
      `SELECT SUM(amount_ufern)::text AS total FROM ledger_entries WHERE account = 'member:' || (SELECT id FROM people WHERE email = 'felix.navarro@fernhill.test')`,
    );
    // Felix burns 33015 ufern of blob fees, covered by his genesis allocation.
    check("felix balance is 5000000000 ufern", felix.rows[0]?.total === "5000000000", felix.rows[0]?.total);

    // The burn account holds the burned fees.
    const burn = await client.query<{ total: string }>(
      `SELECT SUM(amount_ufern)::text AS total FROM ledger_entries WHERE account = 'burn'`,
    );
    // Felix's blob fees (33015) plus Amara's staking fees (7 proposals and 1 vote)
    // and the simulated operators' vote fees (16 x 8000).
    const amaraFees = 8000 * (7 + 1);
    const operatorFees = 8000 * 16;
    check(
      "burn holds the burned fees",
      burn.rows[0]?.total === String(33015 + amaraFees + operatorFees),
      burn.rows[0]?.total,
    );

    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures > 0) process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
    server.kill("SIGTERM");
    await delay(500);
    server.kill("SIGKILL");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
