import { describe, expect, it } from "vitest";
import { createDbPool } from "../src/server/pool";
import { poolStore } from "../src/server/db";
import { applySchemaAndSeed } from "../src/server/seed";

describe("database serve", () => {
  it("applies the schema and seed idempotently", async () => {
    const pool = createDbPool(process.env["DATABASE_URL"] ?? "").raw();
    const store = poolStore(pool);
    await store.query(
      `DROP TABLE IF EXISTS answers, disputes, sheets, idempotency_records, published_scores, sessions, rounds, teams, desk_codes, league_meta CASCADE`,
    );
    await applySchemaAndSeed(store);
    await applySchemaAndSeed(store);
    const teams = await store.query(`SELECT COUNT(*)::int AS c FROM teams`);
    const rounds = await store.query(`SELECT COUNT(*)::int AS c FROM rounds`);
    const codes = await store.query(`SELECT COUNT(*)::int AS c FROM desk_codes`);
    const scores = await store.query(`SELECT COUNT(*)::int AS c FROM published_scores`);
    const version = await store.query(`SELECT value FROM league_meta WHERE key = 'table_version'`);
    expect(teams.rows[0]?.["c"]).toBe(12);
    expect(rounds.rows[0]?.["c"]).toBe(8);
    expect(codes.rows[0]?.["c"]).toBe(14);
    expect(scores.rows[0]?.["c"]).toBe(36);
    expect(version.rows[0]?.["value"]).toBe("1");
    await pool.end();
  });
});
