// Applies the schema and replays the seeded history. Both are idempotent on every start.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { EARLY_CLOSES_2026, HOLIDAYS_2026, loadCalendar, sessionDay } from "./calendar.ts";
import { catchUpCloses, processClose } from "./closes.ts";
import { readMarketClock } from "./clock.ts";
import type { PoolClient } from "pg";
import { database, lockLedger, one, text, withTransaction, type Queryable } from "./db.ts";
import { publishRestatement } from "./publication.ts";
import { applyChange, insertDraft, replaceShareEvents } from "./restatements.ts";
import { SCHEMA_SQL } from "./schema.ts";
import { hashPassword, listStaff, seedStaffUser } from "./sessions.ts";
import { recordTick } from "./ticks.ts";
import type { Role } from "../shared/domain.ts";
import { addCalendarDays, wallTimeToInstant } from "../shared/newyork.ts";
import { rowsOf } from "./restatementRows.ts";

const SEED_PASSWORD = "tracewell-rehearsal-26";

const STAFF: ReadonlyArray<readonly [string, string, Role[]]> = [
  ["Tamsin Okafor", "tamsin.okafor@vellichor.example", ["treasury_analyst"]],
  ["Imre Castellanos", "imre.castellanos@vellichor.example", ["treasury_analyst", "disclosure_counsel", "disclosure_officer"]],
  ["Rafe Lindqvist", "rafe.lindqvist@vellichor.example", ["disclosure_counsel"]],
  ["Wren Adeyemi", "wren.adeyemi@vellichor.example", ["disclosure_counsel", "disclosure_officer"]],
  ["Noor Halvorsen", "noor.halvorsen@vellichor.example", ["disclosure_officer"]],
  ["Basil Ferreira", "basil.ferreira@vellichor.example", ["operator"]],
];

const CORRECTION_REASON = "Staking rewards understated by 10 ETH; the validator reward export omitted epochs for 2026-10-17.";

interface SeedRestatement {
  accession: string;
  weekEnding: string;
  correctsAccession: string | null;
  rows: [string, string, string, string, string, string];
  event: { kind: "atm_settlement" | "buyback"; shares: string; effectiveDate: string } | null;
  publishedAt: string;
}

const SEED_RESTATEMENTS: SeedRestatement[] = [
  { accession: "0002093117-26-000041", weekEnding: "2026-10-11", correctsAccession: null, rows: ["401250", "6120.5", "412.375", "407782.875", "10256.625", "148250000"], event: null, publishedAt: "2026-10-12 17:30:05" },
  { accession: "0002093117-26-000044", weekEnding: "2026-10-18", correctsAccession: null, rows: ["407782.875", "4980.25", "408.0625", "413171.1875", "10664.6875", "150650000"], event: { kind: "atm_settlement", shares: "2400000", effectiveDate: "2026-10-14" }, publishedAt: "2026-10-19 17:30:05" },
  { accession: "0002093117-26-000046", weekEnding: "2026-10-18", correctsAccession: "0002093117-26-000044", rows: ["407782.875", "4980.25", "418.0625", "413181.1875", "10674.6875", "150650000"], event: { kind: "atm_settlement", shares: "2400000", effectiveDate: "2026-10-14" }, publishedAt: "2026-10-21 18:00:05" },
  { accession: "0002093117-26-000049", weekEnding: "2026-10-25", correctsAccession: null, rows: ["413181.1875", "0", "421.5", "413602.6875", "11096.1875", "150150000"], event: { kind: "buyback", shares: "500000", effectiveDate: "2026-10-22" }, publishedAt: "2026-10-26 17:30:05" },
];

const SEED_TICKS: ReadonlyArray<readonly [string, "VLCH" | "ETH-USD", string, string]> = [
  ["2026-10-12", "VLCH", "15:59:00", "13.94"], ["2026-10-12", "ETH-USD", "17:30:00", "3382.40"],
  ["2026-10-19", "VLCH", "15:59:00", "14.21"], ["2026-10-19", "ETH-USD", "17:30:00", "3401.15"],
  ["2026-10-21", "VLCH", "15:59:00", "14.35"], ["2026-10-21", "ETH-USD", "18:00:00", "3396.80"],
  ["2026-10-26", "VLCH", "15:59:00", "14.62"], ["2026-10-26", "ETH-USD", "17:30:00", "3410.05"],
  ["2026-10-27", "VLCH", "15:59:00", "14.71"],
  ["2026-10-28", "VLCH", "15:59:00", "14.58"],
  ["2026-10-29", "VLCH", "15:59:00", "14.90"],
  ["2026-10-30", "VLCH", "15:59:00", "14.77"], ["2026-10-30", "ETH-USD", "17:00:00", "3415.90"],
];

const FIRST_SEED_DATE = "2026-10-12";
const LAST_SEED_DATE = "2026-10-30";

interface SeedExhibit {
  accession: string;
  bytes: Buffer;
  sha256: string;
  key: string;
}

export function seedExhibits(): SeedExhibit[] {
  return SEED_RESTATEMENTS.map((entry) => {
    const bytes = readFileSync(fileURLToPath(new URL(`../seed/exhibits/${entry.accession}.pdf`, import.meta.url)));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { accession: entry.accession, bytes, sha256, key: `exhibits/${entry.accession}/${sha256}.pdf` };
  });
}

function wall(date: string, clock: string): number {
  const [hour = "0", minute = "0", second = "0"] = clock.split(":");
  const instant = wallTimeToInstant(date, Number(hour), Number(minute), Number(second));
  if (instant === null) throw new RangeError("seed instant does not exist");
  return instant;
}

type ReplayEvent =
  | { at: number; order: 0; tick: { id: string; instrument: "VLCH" | "ETH-USD"; price: string } }
  | { at: number; order: 1; close: string }
  | { at: number; order: 2; publication: SeedRestatement };

function replayEvents(): ReplayEvent[] {
  const events: ReplayEvent[] = [];
  for (const [date, instrument, clock, price] of SEED_TICKS) {
    events.push({ at: wall(date, clock), order: 0, tick: { id: `seed-${date}-${instrument === "VLCH" ? "vlch" : "eth"}`, instrument, price } });
  }
  for (let date = FIRST_SEED_DATE; date <= LAST_SEED_DATE; date = addCalendarDays(date, 1)) {
    const closesAt = sessionDay(date).closesAt;
    if (closesAt !== null) events.push({ at: closesAt, order: 1, close: date });
  }
  for (const publication of SEED_RESTATEMENTS) events.push({ at: wall(publication.publishedAt.slice(0, 10), publication.publishedAt.slice(11)), order: 2, publication });
  return events.sort((a, b) => a.at - b.at || a.order - b.order);
}

async function userId(q: Queryable, email: string): Promise<string> {
  const staff = await listStaff(q);
  const user = staff.get(email);
  if (!user) throw new Error("seed staff member is missing");
  return user.id;
}

async function seedPublication(q: Queryable, entry: SeedRestatement, at: number): Promise<void> {
  const tamsin = await userId(q, "tamsin.okafor@vellichor.example");
  const rafe = await userId(q, "rafe.lindqvist@vellichor.example");
  const noor = await userId(q, "noor.halvorsen@vellichor.example");
  const exhibit = seedExhibits().find((candidate) => candidate.accession === entry.accession);
  if (!exhibit) throw new Error("seed exhibit is missing");
  const corrected = entry.correctsAccession ? await one(q, "SELECT id FROM restatements WHERE accession = $1", [entry.correctsAccession]) : null;
  const draft = await insertDraft(q, {
    weekEnding: entry.weekEnding,
    supersedes: corrected ? text(corrected, "id") : null,
    correctionReason: null,
    rows: rowsOf({}),
    shareEvents: [],
    accession: null,
    exhibitPage: null,
    preparedBy: tamsin,
    at,
  });
  const [beginning, acquired, rewards, ending, cumulative, shares] = entry.rows;
  const rows = rowsOf({ "beginning-balance": beginning, "eth-acquired": acquired, "staking-rewards": rewards, "ending-balance": ending, "cumulative-staking-rewards": cumulative, "diluted-shares": shares });
  if (entry.event) await replaceShareEvents(q, draft.id, [entry.event]);
  const edited = await applyChange(q, draft, {
    action: "edit",
    actorId: tamsin,
    at,
    toState: "draft",
    set: { rows, accession: entry.accession, exhibit_page: 1, correction_reason: corrected ? CORRECTION_REASON : null },
  });
  const pending = await applyChange(q, edited, { action: "exhibit_pending", actorId: tamsin, at, toState: "draft" });
  const verified = await applyChange(q, pending, {
    action: "exhibit_verified",
    actorId: tamsin,
    at,
    toState: "draft",
    set: { exhibit_status: "verified", exhibit_sha256: exhibit.sha256, exhibit_bytes: exhibit.bytes.length, exhibit_key: exhibit.key },
  });
  const submitted = await applyChange(q, verified, { action: "submit", actorId: tamsin, at, toState: "in_review" });
  const cleared = await applyChange(q, submitted, { action: "clear", actorId: rafe, at, toState: "cleared", set: { cleared_by: rafe } });
  await publishRestatement(q, cleared, { at, actorId: noor });
}

async function replaySeed(q: Queryable): Promise<void> {
  for (const event of replayEvents()) {
    if (event.order === 0) {
      await recordTick(q, { ...event.tick, at: event.at });
    } else if (event.order === 1) {
      await processClose(q, event.close, event.at);
    } else {
      await seedPublication(q, event.publication, event.at);
    }
  }
}

async function applySchemaAndReferenceData(client: PoolClient): Promise<void> {
  await client.query(SCHEMA_SQL);
  const passwordHash = await hashPassword(SEED_PASSWORD);
  for (const [name, email, roles] of STAFF) await seedStaffUser(client, name, email, roles, passwordHash);
  for (const [date, holiday] of HOLIDAYS_2026) {
    await client.query("INSERT INTO session_calendar (date, holiday, early_close) VALUES ($1, $2, false) ON CONFLICT (date) DO NOTHING", [date, holiday]);
  }
  for (const date of EARLY_CLOSES_2026) {
    await client.query("INSERT INTO session_calendar (date, holiday, early_close) VALUES ($1, NULL, true) ON CONFLICT (date) DO NOTHING", [date]);
  }
  await client.query("INSERT INTO tape_state (singleton, state, position) VALUES (true, 'playing', 0) ON CONFLICT (singleton) DO NOTHING");
  await client.query("INSERT INTO market_clock (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING");
}

export async function prepareDatabase(): Promise<void> {
  const client = await database().connect();
  try {
    await client.query("SELECT pg_advisory_lock(7340100)");
    try {
      await applySchemaAndReferenceData(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock(7340100)");
    }
  } finally {
    client.release();
  }
  await loadCalendar(database());
  await withTransaction(async (tx) => {
    await lockLedger(tx);
    const marked = await one(tx, "SELECT 1 FROM seed_marks WHERE name = 'history'");
    if (marked) return;
    await replaySeed(tx);
    await tx.query("INSERT INTO seed_marks (name) VALUES ('history')");
  });
  await withTransaction(async (tx) => {
    await lockLedger(tx);
    await catchUpCloses(tx, (await readMarketClock(tx)).now);
  });
}
