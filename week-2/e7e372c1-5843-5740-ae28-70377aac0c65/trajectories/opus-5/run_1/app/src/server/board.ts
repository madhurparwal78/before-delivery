/**
 * The board API body: the three clocks the server decides, the four current
 * figure computations and the weekly history.
 */
import { Transaction, transact } from './db';
import { loadConfig } from './config';
import { FIGURE_KEYS, FigureKey } from '../shared/labels';
import { newYorkDateStringOf, parseDateString, toIso } from '../shared/nytime';
import { closesAtIfOpen, isSessionOpenAt, weekEndInstant } from '../domain/calendar';
import { isEthStale } from '../domain/staleness';
import { marketClockNow } from './marketClock';
import { latestTickBefore, lastTradeInSession, officialCloseAt } from './marketData';
import { ComputationPayload, computationForRestatement, currentComputation } from './computations';
import { vaultStatus, VaultStatus } from './vault';

const config = loadConfig();

export interface BoardClocks {
  equity: {
    status: 'open' | 'closed';
    closes_at: string | null;
    last_trade: { id: string; price: string; at: string } | null;
    official_close: { date: string; price: string } | null;
  };
  eth: {
    status: 'live' | 'stale';
    last_tick: { id: string; price: string; at: string } | null;
  };
  holdings: {
    week_ending: string | null;
    as_of: string | null;
    restatement_id: string | null;
  };
}

export interface HistoryRow {
  restatement_id: string;
  week_ending: string;
  state: 'published' | 'superseded';
  beginning_balance: string;
  eth_acquired: string;
  staking_rewards: string;
  ending_balance: string;
  cumulative_staking_rewards: string;
  diluted_shares: string;
  eth_per_1000_diluted: { computation_id: string; value: string; display: string } | null;
  exhibit: { accession: string; sha256: string; page: number } | null;
  published_at: string | null;
  restated: { on: string; reason: string; superseded_by: string } | null;
}

export interface BoardPayload {
  server_time: string;
  market_date: string;
  vault: VaultStatus;
  clocks: BoardClocks;
  figures: ComputationPayload[];
  history: HistoryRow[];
}

interface HistorySourceRow {
  id: string;
  week_ending: string;
  state: string;
  supersedes: string | null;
  correction_reason: string | null;
  row_beginning_balance: string;
  row_eth_acquired: string;
  row_staking_rewards: string;
  row_ending_balance: string;
  row_cumulative_staking_rewards: string;
  row_diluted_shares: string;
  accession: string | null;
  exhibit_sha256: string | null;
  exhibit_page: number | null;
  published_at: Date | null;
  superseded_by: string | null;
}

async function buildClocks(tx: Transaction, nowMs: number): Promise<BoardClocks> {
  const open = isSessionOpenAt(nowMs);
  const lastTrade = open ? await lastTradeInSession(tx, nowMs) : null;
  const close = await officialCloseAt(tx, nowMs);
  const ethTick = await latestTickBefore(tx, 'ETH-USD', nowMs);

  const latest = await tx.query<{ id: string; week_ending: string }>(
    `SELECT id, week_ending FROM restatement WHERE state = 'published'
      ORDER BY week_ending DESC LIMIT 1`,
  );
  const holdingsRow = latest[0];
  const holdingsWeek = holdingsRow ? parseDateString(holdingsRow.week_ending) : null;

  return {
    equity: {
      status: open ? 'open' : 'closed',
      closes_at: open ? toIso(closesAtIfOpen(nowMs) ?? nowMs) : null,
      last_trade:
        lastTrade === null
          ? null
          : { id: lastTrade.id, price: lastTrade.price, at: toIso(lastTrade.atMs) },
      official_close: close === null ? null : { date: close.date, price: close.price },
    },
    eth: {
      status: isEthStale(ethTick === null ? null : ethTick.atMs, nowMs, config.ethStaleSeconds)
        ? 'stale'
        : 'live',
      last_tick:
        ethTick === null ? null : { id: ethTick.id, price: ethTick.price, at: toIso(ethTick.atMs) },
    },
    holdings: {
      week_ending: holdingsRow?.week_ending ?? null,
      as_of: holdingsWeek === null ? null : toIso(weekEndInstant(holdingsWeek)),
      restatement_id: holdingsRow?.id ?? null,
    },
  };
}

async function buildHistory(tx: Transaction): Promise<HistoryRow[]> {
  const rows = await tx.query<HistorySourceRow>(
    `SELECT id, week_ending, state, supersedes, correction_reason,
            row_beginning_balance, row_eth_acquired, row_staking_rewards,
            row_ending_balance, row_cumulative_staking_rewards, row_diluted_shares,
            accession, exhibit_sha256, exhibit_page, published_at, superseded_by
       FROM restatement
      WHERE state IN ('published', 'superseded')
      ORDER BY week_ending DESC, published_at DESC, seq DESC`,
  );
  const byId = new Map<string, HistorySourceRow>();
  for (const row of rows) byId.set(row.id, row);

  const weeks: string[] = [];
  const headsByWeek = new Map<string, HistorySourceRow>();
  for (const row of rows) {
    if (!headsByWeek.has(row.week_ending)) {
      headsByWeek.set(row.week_ending, row);
      weeks.push(row.week_ending);
    } else if (row.state === 'published') {
      headsByWeek.set(row.week_ending, row);
    }
  }

  const ordered: HistorySourceRow[] = [];
  for (const week of weeks) {
    let cursor = headsByWeek.get(week) ?? null;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      ordered.push(cursor);
      cursor = cursor.supersedes === null ? null : byId.get(cursor.supersedes) ?? null;
    }
  }

  const history: HistoryRow[] = [];
  for (const row of ordered) {
    const perThousand = await computationForRestatement(tx, row.id, 'eth-per-1000-diluted');
    const superseder = row.superseded_by === null ? null : byId.get(row.superseded_by) ?? null;
    history.push({
      restatement_id: row.id,
      week_ending: row.week_ending,
      state: row.state as 'published' | 'superseded',
      beginning_balance: row.row_beginning_balance,
      eth_acquired: row.row_eth_acquired,
      staking_rewards: row.row_staking_rewards,
      ending_balance: row.row_ending_balance,
      cumulative_staking_rewards: row.row_cumulative_staking_rewards,
      diluted_shares: row.row_diluted_shares,
      eth_per_1000_diluted:
        perThousand === null
          ? null
          : {
              computation_id: perThousand.id,
              value: perThousand.value,
              display: perThousand.display,
            },
      exhibit:
        row.accession === null || row.exhibit_sha256 === null || row.exhibit_page === null
          ? null
          : { accession: row.accession, sha256: row.exhibit_sha256, page: row.exhibit_page },
      published_at: row.published_at === null ? null : toIso(row.published_at.getTime()),
      restated:
        superseder === null || superseder.published_at === null
          ? null
          : {
              on: newYorkDateStringOf(superseder.published_at.getTime()),
              reason: superseder.correction_reason ?? '',
              superseded_by: superseder.id,
            },
    });
  }
  return history;
}

export async function buildBoard(): Promise<BoardPayload> {
  const nowMs = await marketClockNow();
  return transact(async (tx) => {
    const clocks = await buildClocks(tx, nowMs);
    const figures: ComputationPayload[] = [];
    for (const figure of FIGURE_KEYS) {
      const computation = await currentComputation(tx, figure as FigureKey);
      if (computation !== null) figures.push(computation);
    }
    const history = await buildHistory(tx);
    return {
      server_time: toIso(nowMs),
      market_date: newYorkDateStringOf(nowMs),
      vault: vaultStatus(),
      clocks,
      figures,
      history,
    };
  });
}
