// Stored computations: writing them at the moments the rules name, and reading them back.

import { many, numberValue, one, text, toTimestamp, type Queryable, type Row } from "./db.ts";
import { computeFigure, type EthTick, type FigureResult, type Holdings, type SharePrice } from "./figures.ts";
import { equitySessionAt, sessionDay } from "./calendar.ts";
import { type Computation, type ComputationExhibit, type ComputationInput, type FigureKey, type Restated, type RowKey } from "../shared/domain.ts";
import { dayEnd, formatInstant, newYorkDate, weekEndInstant } from "../shared/newyork.ts";
import { rowsOf } from "./restatementRows.ts";

type Trigger = "publication" | "tick" | "close";

/** The restatement whose rows are the current holdings: the newest published week. */
export async function currentHoldings(q: Queryable): Promise<Holdings | null> {
  const row = await one(
    q,
    `SELECT id, week_ending::text AS week_ending, accession, exhibit_page, exhibit_sha256, rows
       FROM restatements WHERE state = 'published' ORDER BY week_ending DESC LIMIT 1`,
  );
  return row ? holdingsOf(row) : null;
}

function holdingsOf(row: Row): Holdings {
  const stored = storedRows(row);
  return {
    restatementId: text(row, "id"),
    accession: text(row, "accession"),
    sha256: text(row, "exhibit_sha256"),
    page: numberValue(row, "exhibit_page"),
    weekEndInstant: weekEndInstant(text(row, "week_ending")),
    rows: {
      "beginning-balance": requiredRow(stored, "beginning-balance"),
      "eth-acquired": requiredRow(stored, "eth-acquired"),
      "staking-rewards": requiredRow(stored, "staking-rewards"),
      "ending-balance": requiredRow(stored, "ending-balance"),
      "cumulative-staking-rewards": requiredRow(stored, "cumulative-staking-rewards"),
      "diluted-shares": requiredRow(stored, "diluted-shares"),
    },
  };
}

function storedRows(row: Row): Record<RowKey, string | null> {
  return rowsOf(row["rows"]);
}

function requiredRow(rows: Record<RowKey, string | null>, key: RowKey): string {
  const value = rows[key];
  if (value === null) throw new TypeError("published restatement is missing a row");
  return value;
}

export async function ethTickAt(q: Queryable, at: number): Promise<EthTick | null> {
  const row = await one(q, "SELECT id, price, at FROM ticks WHERE instrument = 'ETH-USD' AND at <= $1::timestamptz ORDER BY at DESC, seq DESC LIMIT 1", [toTimestamp(at)]);
  return row ? { id: text(row, "id"), price: text(row, "price"), at: numberValue(row, "at") } : null;
}

/** The latest VLCH tick of today's session, only while that session is open. */
export async function lastTradeAt(q: Queryable, at: number): Promise<EthTick | null> {
  const session = equitySessionAt(at);
  if (session.status !== "open") return null;
  const trade = await one(
    q,
    "SELECT id, price, at FROM ticks WHERE instrument = 'VLCH' AND session_date = $1 AND at <= $2::timestamptz ORDER BY at DESC, seq DESC LIMIT 1",
    [session.date, toTimestamp(at)],
  );
  return trade ? { id: text(trade, "id"), price: text(trade, "price"), at: numberValue(trade, "at") } : null;
}

/** The last trade while the session is open and has traded, otherwise the most recent official close. */
async function sharePriceAt(q: Queryable, at: number): Promise<SharePrice | null> {
  const trade = await lastTradeAt(q, at);
  return trade ? { kind: "tick", ...trade } : officialCloseAt(q, at);
}

/** The official close of a date is the last VLCH tick of that date's session; this is the newest one already closed at `at`. */
export async function officialCloseAt(q: Queryable, at: number): Promise<SharePrice | null> {
  const candidates = await many(
    q,
    `SELECT DISTINCT ON (session_date) session_date::text AS date, price FROM ticks
      WHERE instrument = 'VLCH' AND session_date <= $1 ORDER BY session_date DESC, at DESC, seq DESC LIMIT 5`,
    [newYorkDate(at)],
  );
  for (const candidate of candidates) {
    const date = text(candidate, "date");
    const closeAt = sessionDay(date).closesAt;
    if (closeAt !== null && closeAt <= at) return { kind: "official_close", date, price: text(candidate, "price"), closeAt };
  }
  return null;
}

async function insertComputation(q: Queryable, result: FigureResult, computedAt: number, restatementId: string, trigger: Trigger): Promise<string> {
  const inputs: ComputationInput[] = result.inputs.map(({ asOfInstant: _asOfInstant, ...input }) => input);
  const row = await one(
    q,
    `INSERT INTO computations (figure, computed_at, restatement_id, trigger, label, value, display, as_of, inputs, exhibit)
     VALUES ($1, $2::timestamptz, $3, $4, $5, $6, $7, $8::timestamptz, $9, $10)
     RETURNING id`,
    [result.figure, toTimestamp(computedAt), restatementId, trigger, result.label, result.value, result.display, toTimestamp(result.asOf), JSON.stringify(inputs), JSON.stringify(result.exhibit)],
  );
  if (!row) throw new Error("computation was not stored");
  return text(row, "id");
}

/** Stores the listed figures for the current holdings at `at`; returns the stored ids by figure. */
export async function storeFigures(q: Queryable, figures: readonly FigureKey[], at: number, trigger: Trigger, holdings: Holdings): Promise<Map<FigureKey, string>> {
  const sharePrice = await sharePriceAt(q, at);
  const ethTick = await ethTickAt(q, at);
  const stored = new Map<FigureKey, string>();
  if (!sharePrice || !ethTick) return stored;
  for (const figure of figures) {
    const result = computeFigure(figure, { holdings, sharePrice, ethTick });
    if (result) stored.set(figure, await insertComputation(q, result, at, holdings.restatementId, trigger));
  }
  return stored;
}

/** The mNAV stored on a new tick or a session close. Nothing is stored before the first published week. */
export async function storeMnav(q: Queryable, at: number, trigger: "tick" | "close"): Promise<void> {
  const holdings = await currentHoldings(q);
  if (holdings) await storeFigures(q, ["mnav"], at, trigger, holdings);
}

const COLUMNS = "id, figure, label, value, display, as_of, computed_at, restatement_id, inputs, exhibit, restated";

function computationOf(row: Row): Computation {
  const inputs = row["inputs"];
  const exhibit = row["exhibit"];
  const restated = row["restated"];
  if (!isInputList(inputs) || !isExhibit(exhibit)) throw new TypeError("stored computation is malformed");
  return {
    id: text(row, "id"),
    figure: figureOf(text(row, "figure")),
    label: text(row, "label"),
    value: text(row, "value"),
    display: text(row, "display"),
    as_of: formatInstant(numberValue(row, "as_of")),
    computed_at: formatInstant(numberValue(row, "computed_at")),
    restatement_id: text(row, "restatement_id"),
    restated: isRestated(restated) ? restated : null,
    inputs,
    exhibit,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInputList(value: unknown): value is ComputationInput[] {
  return Array.isArray(value) && value.every((entry) => isRecord(entry) && typeof entry["key"] === "string" && typeof entry["value"] === "string" && isRecord(entry["source"]));
}

function isExhibit(value: unknown): value is ComputationExhibit {
  return isRecord(value) && typeof value["accession"] === "string" && typeof value["sha256"] === "string" && Array.isArray(value["rows"]);
}

function isRestated(value: unknown): value is Restated {
  return isRecord(value) && typeof value["on"] === "string" && typeof value["superseded_by"] === "string";
}

function figureOf(value: string): FigureKey {
  switch (value) {
    case "eth-held":
    case "staking-rewards":
    case "eth-per-1000-diluted":
    case "mnav":
      return value;
    default:
      throw new TypeError("unknown figure");
  }
}

export async function computationById(q: Queryable, id: string): Promise<Computation | null> {
  const row = await one(q, `SELECT ${COLUMNS} FROM computations WHERE id::text = $1`, [id]);
  return row ? computationOf(row) : null;
}

/** The current computation of each figure: the latest `computed_at`, ties broken by later storage order. */
export async function currentComputations(q: Queryable): Promise<Computation[]> {
  const rows = await many(
    q,
    `SELECT DISTINCT ON (figure) ${COLUMNS} FROM computations ORDER BY figure, computed_at DESC, seq DESC`,
  );
  return rows.map(computationOf);
}

/** Citation resolution: the figure's last computation stored before the New York midnight that ends the date. */
export async function citedComputation(q: Queryable, figure: FigureKey, date: string): Promise<Computation | null> {
  const row = await one(
    q,
    `SELECT ${COLUMNS} FROM computations WHERE figure = $1 AND computed_at < $2::timestamptz
      ORDER BY computed_at DESC, seq DESC LIMIT 1`,
    [figure, toTimestamp(dayEnd(date))],
  );
  return row ? computationOf(row) : null;
}

/** Marks every computation drawn from the superseded restatement, once, naming its direct superseder. */
export async function markRestated(q: Queryable, supersededId: string, correctionId: string, onDate: string, reason: string, replacements: Map<FigureKey, string>): Promise<void> {
  for (const [figure, replacementId] of replacements) {
    const marker: Restated = { on: onDate, reason, superseded_by: correctionId, superseding_computation_id: replacementId };
    await q.query("UPDATE computations SET restated = $1 WHERE restatement_id = $2 AND figure = $3 AND restated IS NULL", [JSON.stringify(marker), supersededId, figure]);
  }
}

