// Seed data and its idempotent replay. A fresh database replays the seeded
// history exactly; a later start against the same database duplicates nothing.

import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "./db.js";
import { buildSeedExhibitPdf } from "./exhibitgen.js";
import { hashBytes, ensureSeededExhibit, readExhibitBytes, registerSeededExhibitWriter } from "./vault.js";
import { nyDateString, wallTimeToEpochMs } from "./nytime.js";
import { sessionForDate, shiftDate } from "./calendar.js";
import { writeAudit } from "./audit.js";
import {
  storeMnav,
  storePublicationComputations,
  markComputationsRestated,
  type PublishedRestatementData,
} from "./computations.js";
import { latestEthTick } from "./ticks.js";
import { resolveSharePriceAtClose, resolveSharePrice } from "./close.js";
import { dilutedSharesOnDate, signedShares } from "./ledger.js";
import { marketNow } from "./clock.js";
import type { RowKey } from "./types.js";

const STAFF_PASSWORD = "tracewell-rehearsal-26";

interface SeedStaff {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

const STAFF: SeedStaff[] = [
  { id: "staff-tamsin", name: "Tamsin Okafor", email: "tamsin.okafor@vellichor.example", roles: ["treasury_analyst"] },
  { id: "staff-imre", name: "Imre Castellanos", email: "imre.castellanos@vellichor.example", roles: ["treasury_analyst", "disclosure_counsel", "disclosure_officer"] },
  { id: "staff-rafe", name: "Rafe Lindqvist", email: "rafe.lindqvist@vellichor.example", roles: ["disclosure_counsel"] },
  { id: "staff-wren", name: "Wren Adeyemi", email: "wren.adeyemi@vellichor.example", roles: ["disclosure_counsel", "disclosure_officer"] },
  { id: "staff-noor", name: "Noor Halvorsen", email: "noor.halvorsen@vellichor.example", roles: ["disclosure_officer"] },
  { id: "staff-basil", name: "Basil Ferreira", email: "basil.ferreira@vellichor.example", roles: ["operator"] },
];

function hashPassword(): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(STAFF_PASSWORD, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

interface SeedRestatement {
  accession: string;
  weekEnding: string;
  supersedesAccession: string | null;
  correctionReason: string | null;
  rows: Record<RowKey, string>;
  events: { kind: string; shares: string; effectiveDate: string }[];
  version: number;
  publishedAt: number;
  supersededByAccession: string | null;
  updatedAt: number;
}

function et(year: number, month: number, day: number, hour: number, minute: number, second: number): number {
  const t = wallTimeToEpochMs(year, month, day, hour, minute, second);
  if (t === null) throw new Error("impossible seed instant");
  return t;
}

const SEED_RESTATEMENTS: SeedRestatement[] = [
  {
    accession: "0002093117-26-000041",
    weekEnding: "2026-10-11",
    supersedesAccession: null,
    correctionReason: null,
    rows: {
      "beginning-balance": "401250",
      "eth-acquired": "6120.5",
      "staking-rewards": "412.375",
      "ending-balance": "407782.875",
      "cumulative-staking-rewards": "10256.625",
      "diluted-shares": "148250000",
    },
    events: [],
    version: 7,
    publishedAt: et(2026, 10, 12, 17, 30, 5),
    supersededByAccession: null,
    updatedAt: et(2026, 10, 12, 17, 30, 5),
  },
  {
    accession: "0002093117-26-000044",
    weekEnding: "2026-10-18",
    supersedesAccession: null,
    correctionReason: null,
    rows: {
      "beginning-balance": "407782.875",
      "eth-acquired": "4980.25",
      "staking-rewards": "408.0625",
      "ending-balance": "413171.1875",
      "cumulative-staking-rewards": "10664.6875",
      "diluted-shares": "150650000",
    },
    events: [{ kind: "atm_settlement", shares: "2400000", effectiveDate: "2026-10-14" }],
    version: 8,
    publishedAt: et(2026, 10, 19, 17, 30, 5),
    supersededByAccession: "0002093117-26-000046",
    updatedAt: et(2026, 10, 21, 18, 0, 5),
  },
  {
    accession: "0002093117-26-000046",
    weekEnding: "2026-10-18",
    supersedesAccession: "0002093117-26-000044",
    correctionReason: "Staking rewards understated by 10 ETH; the validator reward export omitted epochs for 2026-10-17.",
    rows: {
      "beginning-balance": "407782.875",
      "eth-acquired": "4980.25",
      "staking-rewards": "418.0625",
      "ending-balance": "413181.1875",
      "cumulative-staking-rewards": "10674.6875",
      "diluted-shares": "150650000",
    },
    events: [{ kind: "atm_settlement", shares: "2400000", effectiveDate: "2026-10-14" }],
    version: 7,
    publishedAt: et(2026, 10, 21, 18, 0, 5),
    supersededByAccession: null,
    updatedAt: et(2026, 10, 21, 18, 0, 5),
  },
  {
    accession: "0002093117-26-000049",
    weekEnding: "2026-10-25",
    supersedesAccession: null,
    correctionReason: null,
    rows: {
      "beginning-balance": "413181.1875",
      "eth-acquired": "0",
      "staking-rewards": "421.5",
      "ending-balance": "413602.6875",
      "cumulative-staking-rewards": "11096.1875",
      "diluted-shares": "150150000",
    },
    events: [{ kind: "buyback", shares: "500000", effectiveDate: "2026-10-22" }],
    version: 7,
    publishedAt: et(2026, 10, 26, 17, 30, 5),
    supersededByAccession: null,
    updatedAt: et(2026, 10, 26, 17, 30, 5),
  },
];

interface SeedTick {
  id: string;
  instrument: "VLCH" | "ETH-USD";
  price: string;
  at: number;
}

const SEED_TICKS: SeedTick[] = [
  { id: "seed-2026-10-12-vlch", instrument: "VLCH", price: "13.94", at: et(2026, 10, 12, 15, 59, 0) },
  { id: "seed-2026-10-12-eth", instrument: "ETH-USD", price: "3382.40", at: et(2026, 10, 12, 17, 30, 0) },
  { id: "seed-2026-10-19-vlch", instrument: "VLCH", price: "14.21", at: et(2026, 10, 19, 15, 59, 0) },
  { id: "seed-2026-10-19-eth", instrument: "ETH-USD", price: "3401.15", at: et(2026, 10, 19, 17, 30, 0) },
  { id: "seed-2026-10-21-vlch", instrument: "VLCH", price: "14.35", at: et(2026, 10, 21, 15, 59, 0) },
  { id: "seed-2026-10-21-eth", instrument: "ETH-USD", price: "3396.80", at: et(2026, 10, 21, 18, 0, 0) },
  { id: "seed-2026-10-26-vlch", instrument: "VLCH", price: "14.62", at: et(2026, 10, 26, 15, 59, 0) },
  { id: "seed-2026-10-26-eth", instrument: "ETH-USD", price: "3410.05", at: et(2026, 10, 26, 17, 30, 0) },
  { id: "seed-2026-10-27-vlch", instrument: "VLCH", price: "14.71", at: et(2026, 10, 27, 15, 59, 0) },
  { id: "seed-2026-10-28-vlch", instrument: "VLCH", price: "14.58", at: et(2026, 10, 28, 15, 59, 0) },
  { id: "seed-2026-10-29-vlch", instrument: "VLCH", price: "14.90", at: et(2026, 10, 29, 15, 59, 0) },
  { id: "seed-2026-10-30-vlch", instrument: "VLCH", price: "14.77", at: et(2026, 10, 30, 15, 59, 0) },
  { id: "seed-2026-10-30-eth", instrument: "ETH-USD", price: "3415.90", at: et(2026, 10, 30, 17, 0, 0) },
];

const FIRST_PUBLICATION = SEED_RESTATEMENTS[0]?.publishedAt as number;

/** Applies the schema, seeds and replay. Idempotent on every start. */
/** Writes seeded exhibits when the vault is reachable; called at start and by the probe timer. */
export async function attemptSeedExhibitWrites(): Promise<void> {
  await writeSeedExhibits(true).catch(() => undefined);
}

export async function applySchemaAndSeed(): Promise<void> {
  const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(schema);

  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'audit_no_update') THEN
        CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $fn$
        BEGIN
          RAISE EXCEPTION 'audit entries are append-only';
        END $fn$ LANGUAGE plpgsql;
        CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON restatement_audit
          FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
      END IF;
    END $$;
  `);

  await seedBaseRows();
  await seedRestatementRows();
  await seedTicks();
  await ensureSessionCloses();
  await replayComputations();
  registerSeededExhibitWriter(writeSeedExhibits);
}

async function seedBaseRows(): Promise<void> {
  await withTransaction(async (client) => {
    const now = Date.now();
    for (const person of STAFF) {
      await client.query(
        `INSERT INTO staff_users (id, name, email, password_hash, roles, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [person.id, person.name, person.email, hashPassword(), person.roles, String(now)],
      );
    }
    await client.query(`INSERT INTO tape_state (id, state, position) VALUES (1, 'playing', 0) ON CONFLICT (id) DO NOTHING`);
    await client.query(`INSERT INTO market_clock (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await client.query(
      `INSERT INTO tick_key (id, key_hex) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`,
      [randomBytes(32).toString("hex")],
    );
  });
}

async function seedRestatementRows(): Promise<void> {
  await withTransaction(async (client) => {
    // Pass 1: insert every restatement without its supersession links.
    for (const spec of SEED_RESTATEMENTS) {
      const existing = await client.query(`SELECT id FROM restatements WHERE accession = $1`, [spec.accession]);
      if (existing.rows.length > 0) continue;

      const id = randomUUID();
      const at = spec.publishedAt;
      const sha = exhibitShaFor(spec.accession);
      await client.query(
        `INSERT INTO restatements (id, version, week_ending, state, supersedes, correction_reason,
            rows_beginning_balance, rows_eth_acquired, rows_staking_rewards, rows_ending_balance,
            rows_cumulative_staking_rewards, rows_diluted_shares, accession, exhibit_page,
            exhibit_sha256, exhibit_status, exhibit_bytes, exhibit_key,
            prepared_by, cleared_by, released_by, created_at, updated_at, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 1,
                 $14, 'verified', $15, $16, 'staff-tamsin', 'staff-rafe', 'staff-noor', $17, $18, $17)`,
        [
          id,
          spec.version,
          spec.weekEnding,
          spec.supersededByAccession === null ? "published" : "superseded",
          null,
          spec.correctionReason,
          spec.rows["beginning-balance"],
          spec.rows["eth-acquired"],
          spec.rows["staking-rewards"],
          spec.rows["ending-balance"],
          spec.rows["cumulative-staking-rewards"],
          spec.rows["diluted-shares"],
          spec.accession,
          sha,
          exhibitPdfFor(spec.accession).length,
          `exhibits/${spec.accession}/${sha}.pdf`,
          String(at),
          String(spec.updatedAt),
        ],
      );
      let position = 0;
      for (const ev of spec.events) {
        await client.query(
          `INSERT INTO share_events (restatement_id, kind, shares, effective_date, position) VALUES ($1, $2, $3, $4, $5)`,
          [id, ev.kind, ev.shares, ev.effectiveDate, position],
        );
        await client.query(
          `INSERT INTO share_count_events (restatement_id, effective_date, signed_shares, position) VALUES ($1, $2, $3, $4)`,
          [id, ev.effectiveDate, signedShares({ kind: ev.kind, shares: ev.shares }), position],
        );
        position += 1;
      }
      await seedAuditTrail(client, id, spec);
    }

    // Pass 2: link corrections to the rows they supersede and are superseded by.
    for (const spec of SEED_RESTATEMENTS) {
      const supersedes = spec.supersedesAccession !== null ? await idForAccession(client, spec.supersedesAccession) : null;
      const supersededBy =
        spec.supersededByAccession !== null ? await idForAccession(client, spec.supersededByAccession) : null;
      await client.query(
        `UPDATE restatements SET supersedes = $2, superseded_by = $3 WHERE accession = $1 AND supersedes IS NULL AND superseded_by IS NULL`,
        [spec.accession, supersedes, supersededBy],
      );
    }
  });
}

async function idForAccession(client: PoolClient, accession: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT id FROM restatements WHERE accession = $1`, [accession]);
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

async function seedAuditTrail(client: PoolClient, id: string, spec: SeedRestatement): Promise<void> {
  const at = spec.publishedAt;
  const trail: { version: number; action: string; actor: string | null; from: string | null; to: string; note: string | null }[] = [
    { version: 1, action: "create", actor: "staff-tamsin", from: null, to: "draft", note: null },
    { version: 2, action: "edit", actor: "staff-tamsin", from: "draft", to: "draft", note: null },
    { version: 3, action: "exhibit_pending", actor: "staff-tamsin", from: "draft", to: "draft", note: null },
    { version: 4, action: "exhibit_verified", actor: "staff-tamsin", from: "draft", to: "draft", note: null },
    { version: 5, action: "submit", actor: "staff-tamsin", from: "draft", to: "in_review", note: null },
    { version: 6, action: "clear", actor: "staff-rafe", from: "in_review", to: "cleared", note: null },
    { version: 7, action: "publish", actor: "staff-noor", from: "cleared", to: "published", note: null },
  ];
  if (spec.supersededByAccession !== null) {
    trail.push({
      version: 8,
      action: "supersede",
      actor: null,
      from: "published",
      to: "superseded",
      note: SEED_RESTATEMENTS.find((r) => r.accession === spec.supersededByAccession)?.correctionReason ?? null,
    });
  }
  for (const entry of trail) {
    await writeAudit(client, id, entry.version, entry.action, entry.actor, at, entry.from as never, entry.to as never, entry.note);
  }
}

async function seedTicks(): Promise<void> {
  await withTransaction(async (client) => {
    for (const tick of SEED_TICKS) {
      await client.query(
        `INSERT INTO ticks (id, instrument, price, at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [tick.id, tick.instrument, tick.price, String(tick.at)],
      );
    }
  });
}

/** Every trading day of 2026, so processing can pick closes up as the clock passes them. */
async function ensureSessionCloses(): Promise<void> {
  const now = await marketNow();
  const today = nyDateString(now);
  const { rows: latest } = await pool.query<{ latest: string | null }>(`SELECT MAX(date) AS latest FROM session_closes`);
  let cursor = latest[0]?.latest ?? "2026-01-01";
  const seen = new Set((await pool.query<{ date: string }>(`SELECT date FROM session_closes`)).rows.map((r) => r.date));
  while (cursor <= today) {
    if (!seen.has(cursor)) {
      const session = sessionForDate(cursor);
      if (session?.tradingDay && session.closeAt !== null) {
        await pool.query(
          `INSERT INTO session_closes (date, close_at) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING`,
          [cursor, String(session.closeAt)],
        );
      }
    }
    cursor = shiftDate(cursor, 1);
  }
}

/**
 * Replays the seeded history in time order: publications at their instants,
 * one mNAV for every seeded tick after the first publication, and one
 * session-close mNAV at every trading-day close after it, up to the clock.
 */
async function replayComputations(): Promise<void> {
  await withTransaction(async (client) => {
    for (const spec of SEED_RESTATEMENTS) {
      const id = await idForAccession(client, spec.accession);
      if (id === null) continue;
      const { rows } = await client.query(`SELECT id FROM computations WHERE restatement_id = $1 LIMIT 1`, [id]);
      if (rows.length > 0) continue;
      const data = await publishedDataFor(client, id, spec);
      await storePublicationComputations(client, data, spec.publishedAt);
      await storePublicationMnav(client, data, spec.publishedAt);
      if (spec.supersedesAccession !== null) {
        const supersededId = await idForAccession(client, spec.supersedesAccession);
        if (supersededId !== null) {
          await markComputationsRestated(client, supersededId, {
            publishedAt: spec.publishedAt,
            reason: spec.correctionReason ?? "",
            correctionId: id,
          });
        }
      }
    }

    // One mNAV per seeded tick after the first publication.
    for (const tick of SEED_TICKS) {
      if (tick.at <= FIRST_PUBLICATION) continue;
      const { rows } = await client.query(
        `SELECT id FROM computations WHERE figure = 'mnav' AND computed_at = $1`,
        [String(tick.at)],
      );
      if (rows.length > 0) continue;
      await storeTickMnavReplay(client, tick);
    }

    // One mNAV per close after the first publication, up to the market clock.
    const now = await marketNow();
    const { rows: closes } = await client.query(
      `SELECT date, close_at FROM session_closes WHERE close_at > $1 AND close_at <= $2 ORDER BY close_at`,
      [String(FIRST_PUBLICATION), String(now)],
    );
    for (const row of closes) {
      const closeAt = Number(row.close_at);
      const { rows } = await client.query(
        `SELECT id FROM computations WHERE figure = 'mnav' AND computed_at = $1`,
        [String(closeAt)],
      );
      if (rows.length > 0) continue;
      await storeCloseMnavReplay(client, row.date as string, closeAt);
    }
  });
}

async function publishedDataFor(
  client: PoolClient,
  id: string,
  spec: SeedRestatement,
): Promise<PublishedRestatementData> {
  const { rows } = await client.query(
    `SELECT week_ending, accession, exhibit_sha256, exhibit_page FROM restatements WHERE id = $1`,
    [id],
  );
  const r = rows[0] as { week_ending: string; accession: string; exhibit_sha256: string; exhibit_page: number };
  const diluted = await dilutedSharesOnDate(client, r.week_ending, spec.publishedAt);
  return {
    id,
    weekEnding: r.week_ending,
    rows: { ...spec.rows, "diluted-shares": diluted },
    accession: r.accession,
    exhibitSha256: r.exhibit_sha256,
    exhibitPage: r.exhibit_page,
    dilutedShares: diluted,
  };
}

async function storePublicationMnav(client: PoolClient, data: PublishedRestatementData, at: number): Promise<void> {
  const sharePrice = await resolveSharePrice(at);
  const ethTick = await latestEthTick(client);
  if (!sharePrice || !ethTick) return;
  await storeMnav(
    client,
    {
      endingBalance: data.rows["ending-balance"] ?? "0",
      dilutedShares: data.dilutedShares,
      sharePrice: sharePrice.price,
      sharePriceSource: sharePrice.source,
      sharePriceLabel: sharePrice.label,
      sharePriceAsOf: sharePrice.asOf,
      ethPrice: ethTick.price,
      ethTickId: ethTick.id,
      ethTickAt: ethTick.at,
      restatement: data,
    },
    at,
  );
}

async function storeTickMnavReplay(client: PoolClient, tick: SeedTick): Promise<void> {
  const published = await latestPublishedAsOf(client, tick.at);
  if (!published) return;
  const ethTick =
    tick.instrument === "ETH-USD"
      ? { price: tick.price, id: tick.id, at: tick.at }
      : await latestEthTickAt(client, tick.at);
  if (!ethTick) return;
  const sharePrice = await resolveSharePrice(tick.at);
  if (!sharePrice) return;
  await storeMnav(
    client,
    {
      endingBalance: published.rows["ending-balance"] ?? "0",
      dilutedShares: published.dilutedShares,
      sharePrice: sharePrice.price,
      sharePriceSource: sharePrice.source,
      sharePriceLabel: sharePrice.label,
      sharePriceAsOf: sharePrice.asOf,
      ethPrice: ethTick.price,
      ethTickId: ethTick.id,
      ethTickAt: ethTick.at,
      restatement: published,
    },
    tick.at,
  );
}

async function storeCloseMnavReplay(client: PoolClient, date: string, closeAt: number): Promise<void> {
  const published = await latestPublishedAsOf(client, closeAt);
  if (published) {
    const sharePrice = await resolveSharePriceAtClose(closeAt, date);
    const ethTick = await latestEthTickAt(client, closeAt);
    if (sharePrice && ethTick) {
      await storeMnav(
        client,
        {
          endingBalance: published.rows["ending-balance"] ?? "0",
          dilutedShares: published.dilutedShares,
          sharePrice: sharePrice.price,
          sharePriceSource: sharePrice.source,
          sharePriceLabel: sharePrice.label,
          sharePriceAsOf: sharePrice.asOf,
          ethPrice: ethTick.price,
          ethTickId: ethTick.id,
          ethTickAt: ethTick.at,
          restatement: published,
        },
        closeAt,
      );
    }
  }
  // Mark the close processed so the background processor never repeats it.
  await client.query(`UPDATE session_closes SET processed_at = $2 WHERE date = $1 AND processed_at IS NULL`, [
    date,
    String(Date.now()),
  ]);
}

async function latestPublishedAsOf(client: PoolClient, asOf: number): Promise<PublishedRestatementData | null> {
  const { rows } = await client.query(
    `SELECT id, week_ending, accession, exhibit_sha256, exhibit_page
       FROM restatements
      WHERE state IN ('published','superseded') AND published_at IS NOT NULL AND published_at <= $1
      ORDER BY published_at DESC LIMIT 1`,
    [String(asOf)],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as { id: string; week_ending: string; accession: string; exhibit_sha256: string; exhibit_page: number };
  const diluted = await dilutedSharesOnDate(client, r.week_ending, asOf);
  const { rows: rowRows } = await client.query(
    `SELECT rows_beginning_balance, rows_eth_acquired, rows_staking_rewards, rows_ending_balance,
            rows_cumulative_staking_rewards FROM restatements WHERE id = $1`,
    [r.id],
  );
  const rr = rowRows[0] as Record<string, string | null>;
  return {
    id: r.id,
    weekEnding: r.week_ending,
    rows: {
      "beginning-balance": rr.rows_beginning_balance ?? null,
      "eth-acquired": rr.rows_eth_acquired ?? null,
      "staking-rewards": rr.rows_staking_rewards ?? null,
      "ending-balance": rr.rows_ending_balance ?? null,
      "cumulative-staking-rewards": rr.rows_cumulative_staking_rewards ?? null,
      "diluted-shares": diluted,
    },
    accession: r.accession,
    exhibitSha256: r.exhibit_sha256,
    exhibitPage: r.exhibit_page,
    dilutedShares: diluted,
  };
}

async function latestEthTickAt(client: PoolClient, at: number): Promise<{ id: string; price: string; at: number } | null> {
  const { rows } = await client.query(
    `SELECT id, price, at FROM ticks WHERE instrument = 'ETH-USD' AND at <= $1 ORDER BY at DESC LIMIT 1`,
    [String(at)],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as { id: string; price: string; at: string };
  return { id: r.id, price: r.price, at: Number(r.at) };
}

const exhibitPdfCache = new Map<string, Buffer>();
const exhibitHashCache = new Map<string, string>();

function exhibitPdfFor(accession: string): Buffer {
  const cached = exhibitPdfCache.get(accession);
  if (cached) return cached;
  const spec = SEED_RESTATEMENTS.find((r) => r.accession === accession);
  if (!spec) throw new Error("unknown seed exhibit");
  const pdf = buildSeedExhibitPdf({ accession, weekEnding: spec.weekEnding, rows: spec.rows });
  exhibitPdfCache.set(accession, pdf);
  exhibitHashCache.set(accession, hashBytes(pdf));
  return pdf;
}

function exhibitShaFor(accession: string): string {
  exhibitPdfFor(accession);
  return exhibitHashCache.get(accession) as string;
}

async function writeSeedExhibits(available: boolean): Promise<void> {
  if (!available) return;
  for (const spec of SEED_RESTATEMENTS) {
    const sha = exhibitShaFor(spec.accession);
    const existing = await readExhibitBytes(spec.accession, sha);
    if (existing !== null) continue;
    await ensureSeededExhibit(spec.accession, sha, exhibitPdfFor(spec.accession));
  }
}
