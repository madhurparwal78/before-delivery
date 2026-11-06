// Stored computations: each figure value is computed once and stored. Every
// public surface reads these rows and never recomputes.

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { pool } from "./db.js";
import { Decimal } from "./decimal.js";
import {
  displayEth,
  displayEthPer1000,
  displayMnav,
  displayShares,
  displayUsd,
  FIGURE_LABELS,
  type FigureKey,
} from "./display.js";
import { nyDateString } from "./nytime.js";
import { ROW_LABELS, type ComputationInput, type ComputationRecord, type RowKey, type TickRecord } from "./types.js";
import { weekEndMs } from "./calendar.js";

interface StoredComputationRow extends QueryResultRow {
  id: string;
  figure: string;
  value: string;
  display: string;
  as_of: string;
  computed_at: string;
  stored_order: string;
  restatement_id: string | null;
  sets_as_of_input: string;
  inputs: ComputationInput[];
  restated_on: string | null;
  restated_reason: string | null;
  superseded_by: string | null;
  superseding_computation_id: string | null;
}

export interface PublishedRestatementData {
  id: string;
  weekEnding: string;
  rows: Record<RowKey, string | null>;
  accession: string;
  exhibitSha256: string;
  exhibitPage: number;
  dilutedShares: string;
}

function inputFrom(
  key: string,
  label: string,
  clock: ComputationInput["clock"],
  value: string,
  display: string,
  asOf: number,
  source: ComputationInput["source"],
): ComputationInput {
  return { key, label, clock, value, display, as_of: asOf, sets_as_of: false, source };
}

function finalizeInputs(inputs: ComputationInput[]): { inputs: ComputationInput[]; asOf: number; setsKey: string } {
  let oldest = inputs[0]?.as_of ?? 0;
  for (const input of inputs) if (input.as_of < oldest) oldest = input.as_of;
  let setsKey = "";
  const result = inputs.map((input) => {
    const sets = input.as_of === oldest && setsKey === "";
    if (sets) setsKey = input.key;
    return { ...input, sets_as_of: sets };
  });
  return { inputs: result, asOf: oldest, setsKey };
}

async function store(
  client: PoolClient,
  figure: FigureKey,
  value: string,
  computedAt: number,
  restatementId: string | null,
  inputs: ComputationInput[],
): Promise<ComputationRecord> {
  const { inputs: finalInputs, asOf } = finalizeInputs(inputs);
  const display = displayFor(figure, value);
  const id = randomUUID();
  await client.query(
    `INSERT INTO computations (id, figure, value, display, as_of, computed_at, restatement_id, sets_as_of_input, inputs)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, figure, value, display, String(asOf), String(computedAt), restatementId, finalInputs[0]?.key ?? "", JSON.stringify(finalInputs)],
  );
  return {
    id,
    figure,
    value,
    display,
    as_of: asOf,
    computed_at: computedAt,
    restatement_id: restatementId,
    inputs: finalInputs,
    restated: null,
  };
}

export function displayFor(figure: FigureKey, value: string): string {
  switch (figure) {
    case "eth-held":
    case "staking-rewards":
      return displayEth(value);
    case "eth-per-1000-diluted":
      return displayEthPer1000(value);
    case "mnav":
      return displayMnav(value);
  }
}

export async function storePublicationComputations(
  client: PoolClient,
  data: PublishedRestatementData,
  computedAt: number,
): Promise<ComputationRecord[]> {
  const weekEndAsOf = weekEndMs(data.weekEnding);
  const exhibitSource = (rowKey: RowKey): ComputationInput["source"] => ({
    kind: "exhibit",
    restatement_id: data.id,
    accession: data.accession,
    sha256: data.exhibitSha256,
    page: data.exhibitPage,
    row: ROW_LABELS[rowKey],
  });
  const filedInput = (rowKey: RowKey, display: string): ComputationInput =>
    inputFrom(rowKey, ROW_LABELS[rowKey], "holdings", data.rows[rowKey] ?? "", display, weekEndAsOf, exhibitSource(rowKey));

  const out: ComputationRecord[] = [];

  // Total ETH held = beginning + acquired + staking rewards.
  const beginning = filedInput("beginning-balance", displayEth(data.rows["beginning-balance"] ?? "0"));
  const acquired = filedInput("eth-acquired", displayEth(data.rows["eth-acquired"] ?? "0"));
  const rewardsWeek = filedInput("staking-rewards", displayEth(data.rows["staking-rewards"] ?? "0"));
  const totalHeld = sumRowValues(data.rows);
  out.push(
    await store(client, "eth-held", totalHeld, computedAt, data.id, [beginning, acquired, rewardsWeek]),
  );

  // Cumulative staking rewards.
  const cumulative = filedInput("cumulative-staking-rewards", displayEth(data.rows["cumulative-staking-rewards"] ?? "0"));
  out.push(await store(client, "staking-rewards", exactValue(data.rows["cumulative-staking-rewards"]), computedAt, data.id, [cumulative]));

  // ETH per 1,000 diluted shares = ending ÷ diluted shares × 1000.
  const ending = filedInput("ending-balance", displayEth(data.rows["ending-balance"] ?? "0"));
  const diluted = filedInput("diluted-shares", displayShares(data.dilutedShares));
  const endingVal = Decimal.fromString(data.rows["ending-balance"] ?? "0") ?? Decimal.zero;
  const sharesVal = Decimal.fromString(data.dilutedShares) ?? Decimal.zero;
  const perThousand = endingVal.div(sharesVal, 18).mul(Decimal.fromInteger(1000));
  out.push(await store(client, "eth-per-1000-diluted", perThousand.round(18).toValueString(), computedAt, data.id, [ending, diluted]));

  return out;
}

function sumRowValues(rows: Record<RowKey, string | null>): string {
  const beginning = Decimal.fromString(rows["beginning-balance"] ?? "0") ?? Decimal.zero;
  const acquired = Decimal.fromString(rows["eth-acquired"] ?? "0") ?? Decimal.zero;
  const rewards = Decimal.fromString(rows["staking-rewards"] ?? "0") ?? Decimal.zero;
  return beginning.add(acquired).add(rewards).round(18).toValueString();
}

function exactValue(raw: string | null): string {
  const d = Decimal.fromString(raw ?? "0") ?? Decimal.zero;
  return d.round(18).toValueString();
}

export interface MnavInputs {
  endingBalance: string;
  dilutedShares: string;
  sharePrice: string;
  sharePriceSource: ComputationInput["source"];
  sharePriceLabel: string;
  sharePriceAsOf: number;
  ethPrice: string;
  ethTickId: string;
  ethTickAt: number;
  restatement: PublishedRestatementData;
}

export async function storeMnav(
  client: PoolClient,
  inputs: MnavInputs,
  computedAt: number,
): Promise<ComputationRecord> {
  const weekEndAsOf = weekEndMs(inputs.restatement.weekEnding);
  const exhibitSource = (rowKey: RowKey): ComputationInput["source"] => ({
    kind: "exhibit",
    restatement_id: inputs.restatement.id,
    accession: inputs.restatement.accession,
    sha256: inputs.restatement.exhibitSha256,
    page: inputs.restatement.exhibitPage,
    row: ROW_LABELS[rowKey],
  });
  const ending = inputFrom(
    "ending-balance",
    ROW_LABELS["ending-balance"],
    "holdings",
    inputs.restatement.rows["ending-balance"] ?? "",
    displayEth(inputs.restatement.rows["ending-balance"] ?? "0"),
    weekEndAsOf,
    exhibitSource("ending-balance"),
  );
  const diluted = inputFrom(
    "diluted-shares",
    ROW_LABELS["diluted-shares"],
    "holdings",
    inputs.restatement.dilutedShares,
    displayShares(inputs.restatement.dilutedShares),
    weekEndAsOf,
    exhibitSource("diluted-shares"),
  );
  const sharePrice = inputFrom(
    "share-price",
    inputs.sharePriceLabel,
    "equity",
    inputs.sharePrice,
    displayUsd(inputs.sharePrice),
    inputs.sharePriceAsOf,
    inputs.sharePriceSource,
  );
  const ethPrice = inputFrom(
    "eth-price",
    "ETH price",
    "eth",
    inputs.ethPrice,
    displayUsd(inputs.ethPrice),
    inputs.ethTickAt,
    { kind: "tick", id: inputs.ethTickId, at: inputs.ethTickAt },
  );

  const endingVal = Decimal.fromString(inputs.endingBalance) ?? Decimal.zero;
  const sharesVal = Decimal.fromString(inputs.dilutedShares) ?? Decimal.zero;
  const sharePriceVal = Decimal.fromString(inputs.sharePrice) ?? Decimal.zero;
  const ethPriceVal = Decimal.fromString(inputs.ethPrice) ?? Decimal.zero;

  // mNAV = (share-price × diluted-shares) ÷ (ending-balance × eth-price)
  const numerator = sharePriceVal.mul(sharesVal);
  const denominator = endingVal.mul(ethPriceVal);
  const mnav = numerator.div(denominator, 18);
  return store(client, "mnav", mnav.toValueString(), computedAt, inputs.restatement.id, [ending, diluted, sharePrice, ethPrice]);
}

export async function currentComputation(figure: FigureKey): Promise<ComputationRecord | null> {
  const { rows } = await pool.query<StoredComputationRow>(
    `SELECT * FROM computations WHERE figure = $1 ORDER BY computed_at DESC, stored_order DESC LIMIT 1`,
    [figure],
  );
  if (rows.length === 0) return null;
  return hydrate(rows[0] as StoredComputationRow);
}

export async function currentComputationsAll(): Promise<Map<FigureKey, ComputationRecord>> {
  const { rows } = await pool.query<StoredComputationRow>(
    `SELECT DISTINCT ON (figure) * FROM computations
      ORDER BY figure, computed_at DESC, stored_order DESC`,
  );
  const out = new Map<FigureKey, ComputationRecord>();
  for (const row of rows) out.set(row.figure as FigureKey, hydrate(row));
  return out;
}

function hydrate(row: StoredComputationRow): ComputationRecord {
  const inputs = (row.inputs ?? []) as ComputationInput[];
  const restored = finalizeInputs(inputs).inputs;
  return {
    id: row.id,
    figure: row.figure as FigureKey,
    value: row.value,
    display: row.display,
    as_of: Number(row.as_of),
    computed_at: Number(row.computed_at),
    restatement_id: row.restatement_id,
    inputs: restored,
    restated:
      row.restated_on && row.restated_reason && row.superseded_by && row.superseding_computation_id
        ? {
            on: row.restated_on,
            reason: row.restated_reason,
            superseded_by: row.superseded_by,
            superseding_computation_id: row.superseding_computation_id,
          }
        : null,
  };
}

export async function computationById(id: string): Promise<ComputationRecord | null> {
  const { rows } = await pool.query<StoredComputationRow>(`SELECT * FROM computations WHERE id = $1`, [id]);
  if (rows.length === 0) return null;
  return hydrate(rows[0] as StoredComputationRow);
}

export async function supersedingComputationFor(
  client: { query: typeof pool.query },
  figure: FigureKey,
  supersederRestatementId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM computations WHERE figure = $1 AND restatement_id = $2
      ORDER BY computed_at DESC, stored_order DESC LIMIT 1`,
    [figure, supersederRestatementId],
  );
  return (rows[0] as { id: string } | undefined)?.id ?? null;
}

/** Mark every computation of the superseded restatement as restated, once. */
export async function markComputationsRestated(
  client: PoolClient,
  supersededRestatementId: string,
  correction: { publishedAt: number; reason: string; correctionId: string },
): Promise<void> {
  const on = nyDateString(correction.publishedAt);
  const { rows } = await client.query<{ id: string; figure: string }>(
    `SELECT id, figure FROM computations WHERE restatement_id = $1`,
    [supersededRestatementId],
  );
  for (const row of rows) {
    const supersedingId = await supersedingComputationFor(client, row.figure as FigureKey, correction.correctionId);
    await client.query(
      `UPDATE computations
          SET restated_on = $2, restated_reason = $3, superseded_by = $4, superseding_computation_id = $5
        WHERE id = $1 AND restated_on IS NULL`,
      [row.id, on, correction.reason, correction.correctionId, supersedingId],
    );
  }
}

export { FIGURE_LABELS };
export type { TickRecord };
