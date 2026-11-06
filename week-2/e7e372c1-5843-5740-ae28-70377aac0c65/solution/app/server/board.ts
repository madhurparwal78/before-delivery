// The public board payload and the rules for ETH staleness and citations.

import { citedComputation, currentComputations, currentHoldings, ethTickAt, lastTradeAt, officialCloseAt } from "./computations.ts";
import { equitySessionAt } from "./calendar.ts";
import { readMarketClock } from "./clock.ts";
import { processPassedCloses } from "./closes.ts";
import { database, many, numberValue, text, textOrNull, withTransaction } from "./db.ts";
import { Refusal } from "./errors.ts";
import { rowsOf } from "./restatementRows.ts";
import { vaultState } from "./vault.ts";
import { FIGURE_KEYS, type BoardResponse, type CitationResponse, type Computation, type HistoryRow, type TickView } from "../shared/domain.ts";
import { formatInstant, newYorkDate, parseCalendarDate } from "../shared/newyork.ts";

/** ETH is stale when no tick exists or the market clock is more than the threshold past the last one. */
function ethClockStatus(lastTickAt: number | null, now: number, staleSeconds: number): "live" | "stale" {
  return lastTickAt === null || now - lastTickAt > staleSeconds * 1000 ? "stale" : "live";
}

function tickView(tick: { id: string; price: string; at: number }): TickView {
  return { id: tick.id, price: tick.price, at: formatInstant(tick.at) };
}

async function historyRows(): Promise<HistoryRow[]> {
  const rows = await many(
    database(),
    `SELECT r.id, r.week_ending::text AS week_ending, r.state, r.rows, r.accession, r.exhibit_sha256, r.exhibit_page,
            r.published_at, r.superseded_by, sup.published_at AS superseded_at, sup.correction_reason AS superseded_reason,
            c.id AS computation_id, c.value, c.display
       FROM restatements r
       LEFT JOIN restatements sup ON sup.id = r.superseded_by
       JOIN computations c ON c.restatement_id = r.id AND c.figure = 'eth-per-1000-diluted' AND c.trigger = 'publication'
      WHERE r.state IN ('published', 'superseded')
      ORDER BY r.week_ending DESC, r.published_at DESC`,
  );
  return rows.map((row) => {
    const stored = rowsOf(row["rows"]);
    const state = text(row, "state") === "superseded" ? "superseded" : "published";
    const supersededAt = row["superseded_at"];
    const supersededBy = textOrNull(row, "superseded_by");
    return {
      restatement_id: text(row, "id"),
      week_ending: text(row, "week_ending"),
      state,
      beginning_balance: stored["beginning-balance"] ?? "",
      eth_acquired: stored["eth-acquired"] ?? "",
      staking_rewards: stored["staking-rewards"] ?? "",
      ending_balance: stored["ending-balance"] ?? "",
      cumulative_staking_rewards: stored["cumulative-staking-rewards"] ?? "",
      diluted_shares: stored["diluted-shares"] ?? "",
      eth_per_1000_diluted: { computation_id: text(row, "computation_id"), value: text(row, "value"), display: text(row, "display") },
      exhibit: { accession: text(row, "accession"), sha256: text(row, "exhibit_sha256"), page: numberValue(row, "exhibit_page") },
      published_at: formatInstant(numberValue(row, "published_at")),
      restated:
        supersededBy !== null && typeof supersededAt === "number"
          ? { on: newYorkDate(supersededAt), reason: text(row, "superseded_reason"), superseded_by: supersededBy }
          : null,
    };
  });
}

export async function boardPayload(staleSeconds: number): Promise<BoardResponse> {
  await processPassedCloses();
  const { now } = await readMarketClock(database());
  const session = equitySessionAt(now);
  const trade = await lastTradeAt(database(), now);
  const close = await officialCloseAt(database(), now);
  const ethTick = await ethTickAt(database(), now);
  const holdings = await currentHoldings(database());
  if (!holdings) throw new Error("no published restatement");
  const weekEnding = newYorkDate(holdings.weekEndInstant);
  return {
    server_time: formatInstant(now),
    market_date: session.date,
    vault: vaultState(),
    clocks: {
      equity: {
        status: session.status,
        closes_at: session.closesAt === null ? null : formatInstant(session.closesAt),
        last_trade: trade ? tickView(trade) : null,
        official_close: close && close.kind === "official_close" ? { date: close.date, price: close.price } : null,
      },
      eth: { status: ethClockStatus(ethTick?.at ?? null, now, staleSeconds), last_tick: ethTick ? tickView(ethTick) : null },
      holdings: { week_ending: weekEnding, as_of: formatInstant(holdings.weekEndInstant), restatement_id: holdings.restatementId },
    },
    figures: await currentFigures(),
    history: await historyRows(),
  };
}

export async function citationPayload(figure: string, date: string): Promise<CitationResponse> {
  const key = FIGURE_KEYS.find((candidate) => candidate === figure);
  if (!key || !parseCalendarDate(date)) throw new Refusal("not_found");
  await processPassedCloses();
  return withTransaction(async (tx) => {
    const { now } = await readMarketClock(tx);
    const today = newYorkDate(now);
    if (date > today) throw new Refusal("not_found");
    const computation = await citedComputation(tx, key, date);
    if (!computation) throw new Refusal("not_found");
    return { citation: { figure: key, date, provisional: date === today }, computation };
  });
}

async function currentFigures(): Promise<Computation[]> {
  const all = await currentComputations(database());
  return FIGURE_KEYS.flatMap((figure) => all.filter((computation) => computation.figure === figure));
}
