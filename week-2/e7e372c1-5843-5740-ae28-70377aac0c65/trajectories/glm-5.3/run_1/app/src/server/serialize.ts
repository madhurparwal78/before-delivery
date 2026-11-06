// Serializers: the exact API body shapes. One place builds every response body.

import type { QueryResultRow } from "pg";
import { pool } from "./db.js";
import { isoString, nyDateString, nyTimeString, epochMsToNyParts } from "./nytime.js";
import { displayShares, FIGURE_LABELS, FIGURE_ORDER, type FigureKey } from "./display.js";
import type { AuditEntryRecord, ComputationInput, ComputationRecord, RestatementRecord } from "./types.js";
import { officialCloseForDate, latestEthTick } from "./ticks.js";
import { sessionForDate, weekEndMs } from "./calendar.js";
import { marketNow } from "./clock.js";
import { vaultAvailable } from "./vault.js";

export function restatementBody(record: RestatementRecord): Record<string, unknown> {
  return {
    id: record.id,
    version: record.version,
    week_ending: record.week_ending,
    state: record.state,
    supersedes: record.supersedes,
    correction_reason: record.correction_reason,
    rows: { ...record.rows },
    share_events: record.share_events.map((e) => ({
      id: e.id,
      kind: e.kind,
      shares: e.shares,
      effective_date: e.effective_date,
    })),
    accession: record.accession,
    exhibit_page: record.exhibit_page,
    exhibit: record.exhibit
      ? {
          status: record.exhibit.status,
          sha256: record.exhibit.sha256,
          bytes: record.exhibit.bytes,
          key: record.exhibit.key,
        }
      : null,
    prepared_by: record.prepared_by,
    cleared_by: record.cleared_by,
    released_by: record.released_by,
    return_note: record.return_note,
    release_at: record.release_at === null ? null : isoString(record.release_at),
    published_at: record.published_at === null ? null : isoString(record.published_at),
    superseded_by: record.superseded_by,
    created_at: isoString(record.created_at),
    updated_at: isoString(record.updated_at),
  };
}

export function auditBody(entry: AuditEntryRecord): Record<string, unknown> {
  return {
    version: entry.version,
    action: entry.action,
    actor: entry.actor,
    at: isoString(entry.at),
    from_state: entry.from_state,
    to_state: entry.to_state,
    note: entry.note,
  };
}

export interface ComputationRow extends QueryResultRow {
  id: string;
  figure: string;
  value: string;
  display: string;
  as_of: string;
  computed_at: string;
  stored_order: string;
  restatement_id: string | null;
  inputs: ComputationInput[];
  restated_on: string | null;
  restated_reason: string | null;
  superseded_by: string | null;
  superseding_computation_id: string | null;
}

export function hydrateComputation(row: ComputationRow): ComputationRecord {
  return {
    id: row.id,
    figure: row.figure as FigureKey,
    value: row.value,
    display: row.display,
    as_of: Number(row.as_of),
    computed_at: Number(row.computed_at),
    restatement_id: row.restatement_id,
    inputs: row.inputs ?? [],
    restated:
      row.restated_on !== null && row.restated_reason !== null && row.superseded_by !== null && row.superseding_computation_id !== null
        ? {
            on: row.restated_on,
            reason: row.restated_reason,
            superseded_by: row.superseded_by,
            superseding_computation_id: row.superseding_computation_id,
          }
        : null,
  };
}

function inputBody(input: ComputationInput): Record<string, unknown> {
  return {
    key: input.key,
    label: input.label,
    clock: input.clock,
    value: input.value,
    display: input.display,
    as_of: isoString(input.as_of),
    sets_as_of: input.sets_as_of,
    source:
      input.source.kind === "exhibit"
        ? {
            kind: "exhibit",
            restatement_id: input.source.restatement_id,
            accession: input.source.accession,
            sha256: input.source.sha256,
            page: input.source.page,
            row: input.source.row,
          }
        : input.source.kind === "tick"
          ? { kind: "tick", id: input.source.id, at: isoString(input.source.at) }
          : { kind: "official_close", date: input.source.date },
  };
}

export function computationBody(record: ComputationRecord): Record<string, unknown> {
  return {
    id: record.id,
    figure: record.figure,
    label: FIGURE_LABELS[record.figure],
    value: record.value,
    display: record.display,
    as_of: isoString(record.as_of),
    computed_at: isoString(record.computed_at),
    restatement_id: record.restatement_id,
    restated: record.restated,
    inputs: record.inputs.map(inputBody),
  };
}

/** The board body: server time, market date, vault state, clocks, figures, history. */
export async function boardBody(): Promise<Record<string, unknown>> {
  const now = await marketNow();
  const marketDate = nyDateString(now);

  const session = sessionForDate(marketDate);
  const sessionInfo = session?.tradingDay && session.openAt !== null && session.closeAt !== null
    ? now >= session.openAt && now < session.closeAt
    : false;
  const closesAt = sessionInfo && session?.closeAt != null ? session.closeAt : null;

  const lastTrade = sessionInfo
    ? await officialCloseForDate(marketDate)
    : null;

  // The most recent official close at or before now.
  const { rows: closeTicks } = await pool.query(
    `SELECT id, price, at FROM ticks WHERE instrument = 'VLCH' AND at <= $1 ORDER BY at DESC LIMIT 1`,
    [String(now)],
  );
  const closeTick = closeTicks[0] as { id: string; price: string; at: string } | undefined;
  let officialClose: { date: string; price: string } | null = null;
  if (closeTick) {
    officialClose = { date: nyDateString(Number(closeTick.at)), price: closeTick.price };
  }

  const eth = await latestEthTick();
  const stale = eth === null || now - eth.at > ethStaleSeconds() * 1000;

  const { rows: holdingsRows } = await pool.query(
    `SELECT id, week_ending FROM restatements WHERE state = 'published'
      ORDER BY week_ending DESC, published_at DESC LIMIT 1`,
  );
  const holdings = holdingsRows[0] as { id: string; week_ending: string } | undefined;

  const figures: Record<string, unknown>[] = [];
  for (const figure of FIGURE_ORDER) {
    const { rows } = await pool.query<ComputationRow>(
      `SELECT * FROM computations WHERE figure = $1 ORDER BY computed_at DESC, stored_order DESC LIMIT 1`,
      [figure],
    );
    if (rows.length === 0) continue;
    figures.push(computationBody(hydrateComputation(rows[0] as ComputationRow)));
  }

  const history = await historyBody();

  return {
    server_time: isoString(now),
    market_date: marketDate,
    vault: vaultAvailable() ? "available" : "unavailable",
    clocks: {
      equity: {
        status: sessionInfo ? "open" : "closed",
        closes_at: closesAt === null ? null : isoString(closesAt),
        last_trade: lastTrade ? { id: lastTrade.id, price: lastTrade.price, at: isoString(lastTrade.at) } : null,
        official_close: officialClose,
      },
      eth: {
        status: stale ? "stale" : "live",
        last_tick: eth ? { id: eth.id, price: eth.price, at: isoString(eth.at) } : null,
      },
      holdings: holdings
        ? { week_ending: holdings.week_ending, as_of: isoString(weekEndMs(holdings.week_ending)), restatement_id: holdings.id }
        : null,
    },
    figures,
    history,
  };
}

async function historyBody(): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(`
    SELECT id, week_ending, state, rows_beginning_balance, rows_eth_acquired, rows_staking_rewards,
           rows_ending_balance, rows_cumulative_staking_rewards, rows_diluted_shares,
           accession, exhibit_sha256, exhibit_page, published_at, correction_reason, superseded_by
      FROM restatements
     WHERE state IN ('published','superseded')
     ORDER BY week_ending DESC,
              CASE WHEN state = 'published' THEN 0 ELSE 1 END,
              published_at DESC
  `);
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const restatementId = r.id as string;
    const perThousand = await currentComputationFor("eth-per-1000-diluted", restatementId);
    const superseded = r.superseded_by !== null;
    const superseder = superseded ? await supersederInfo(r.superseded_by as string) : null;
    out.push({
      restatement_id: restatementId,
      week_ending: r.week_ending,
      state: r.state,
      beginning_balance: r.rows_beginning_balance,
      eth_acquired: r.rows_eth_acquired,
      staking_rewards: r.rows_staking_rewards,
      ending_balance: r.rows_ending_balance,
      cumulative_staking_rewards: r.rows_cumulative_staking_rewards,
      diluted_shares: r.rows_diluted_shares,
      eth_per_1000_diluted: perThousand
        ? { computation_id: perThousand.id, value: perThousand.value, display: perThousand.display }
        : null,
      exhibit: r.exhibit_sha256 !== null ? { accession: r.accession, sha256: r.exhibit_sha256, page: r.exhibit_page } : null,
      published_at: r.published_at === null ? null : isoString(Number(r.published_at)),
      restated: superseder
        ? { on: superseder.on, reason: superseder.reason, superseded_by: r.superseded_by }
        : null,
    });
  }
  return out;
}

async function supersederInfo(id: string): Promise<{ on: string; reason: string } | null> {
  const { rows } = await pool.query(
    `SELECT published_at, correction_reason FROM restatements WHERE id = $1`,
    [id],
  );
  const r = rows[0] as { published_at: string | null; correction_reason: string | null } | undefined;
  if (!r || r.published_at === null) return null;
  return { on: nyDateString(Number(r.published_at)), reason: r.correction_reason ?? "" };
}

async function currentComputationFor(figure: FigureKey, restatementId: string): Promise<ComputationRecord | null> {
  const { rows } = await pool.query<ComputationRow>(
    `SELECT * FROM computations WHERE figure = $1 AND restatement_id = $2
      ORDER BY computed_at DESC, stored_order DESC LIMIT 1`,
    [figure, restatementId],
  );
  if (rows.length === 0) return null;
  return hydrateComputation(rows[0] as ComputationRow);
}

function ethStaleSeconds(): number {
  const raw = process.env.ETH_STALE_SECONDS;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : 120;
}

export { FIGURE_ORDER, FIGURE_LABELS, displayShares, nyTimeString, epochMsToNyParts };
