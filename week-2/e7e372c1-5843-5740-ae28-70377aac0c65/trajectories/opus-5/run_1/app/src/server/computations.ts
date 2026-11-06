/**
 * Figure computation and storage. Each figure is computed once with exact
 * decimal arithmetic and stored; every public surface reads the stored rows.
 */
import { randomBytes } from 'node:crypto';
import { Transaction } from './db';
import {
  COMPUTATION_SCALE,
  Decimal,
  add,
  divide,
  fromInteger,
  multiply,
  parseDecimal,
  toFixed,
} from '../shared/decimal';
import { DisplayFormat, formatDisplay } from '../shared/display';
import { ClockKey, FigureKey, FIGURE_LABELS, ROW_LABELS, RowKey } from '../shared/labels';
import { parseDateString, toIso } from '../shared/nytime';
import { weekEndInstant } from '../domain/calendar';
import { latestTickBefore, lastTradeInSession, officialCloseAt, TickRecord } from './marketData';

export interface ExhibitSource {
  kind: 'exhibit';
  restatement_id: string;
  accession: string;
  sha256: string;
  page: number;
  row: string;
}

export interface TickSource {
  kind: 'tick';
  id: string;
  at: string;
}

export interface OfficialCloseSource {
  kind: 'official_close';
  date: string;
}

export type ComputationSource = ExhibitSource | TickSource | OfficialCloseSource;

export interface ComputationInputPayload {
  key: string;
  label: string;
  clock: ClockKey;
  value: string;
  display: string;
  as_of: string;
  sets_as_of: boolean;
  source: ComputationSource;
}

export interface RestatedPayload {
  on: string;
  reason: string;
  superseded_by: string;
  superseding_computation_id: string;
}

export interface ComputationPayload {
  id: string;
  figure: FigureKey;
  label: string;
  value: string;
  display: string;
  as_of: string;
  computed_at: string;
  restatement_id: string;
  restated: RestatedPayload | null;
  inputs: ComputationInputPayload[];
}

export interface FiledRestatement {
  id: string;
  weekEnding: string;
  accession: string;
  sha256: string;
  page: number;
  rows: Readonly<Record<RowKey, string>>;
}

interface FiledRow {
  id: string;
  week_ending: string;
  accession: string;
  exhibit_sha256: string;
  exhibit_page: number;
  row_beginning_balance: string;
  row_eth_acquired: string;
  row_staking_rewards: string;
  row_ending_balance: string;
  row_cumulative_staking_rewards: string;
  row_diluted_shares: string;
}

function toFiled(row: FiledRow): FiledRestatement {
  return {
    id: row.id,
    weekEnding: row.week_ending,
    accession: row.accession,
    sha256: row.exhibit_sha256,
    page: row.exhibit_page,
    rows: {
      'beginning-balance': row.row_beginning_balance,
      'eth-acquired': row.row_eth_acquired,
      'staking-rewards': row.row_staking_rewards,
      'ending-balance': row.row_ending_balance,
      'cumulative-staking-rewards': row.row_cumulative_staking_rewards,
      'diluted-shares': row.row_diluted_shares,
    },
  };
}

const FILED_COLUMNS = `id, week_ending, accession, exhibit_sha256, exhibit_page,
  row_beginning_balance, row_eth_acquired, row_staking_rewards,
  row_ending_balance, row_cumulative_staking_rewards, row_diluted_shares`;

/** The restatement whose exhibit the public saw at that instant. */
async function currentFiledRestatementAt(
  tx: Transaction,
  atMs: number,
): Promise<FiledRestatement | null> {
  const rows = await tx.query<FiledRow>(
    `SELECT ${FILED_COLUMNS} FROM restatement
      WHERE published_at IS NOT NULL AND published_at <= $1
        AND state IN ('published', 'superseded')
      ORDER BY week_ending DESC, published_at DESC, seq DESC
      LIMIT 1`,
    [new Date(atMs)],
  );
  const row = rows[0];
  return row ? toFiled(row) : null;
}

export async function filedRestatementById(
  tx: Transaction,
  id: string,
): Promise<FiledRestatement | null> {
  const rows = await tx.query<FiledRow>(`SELECT ${FILED_COLUMNS} FROM restatement WHERE id = $1`, [id]);
  const row = rows[0];
  return row ? toFiled(row) : null;
}

function requireDecimal(text: string): Decimal {
  const parsed = parseDecimal(text);
  if (parsed === null) throw new Error('stored row is not a decimal');
  return parsed;
}

const ROW_FORMATS: Readonly<Record<RowKey, DisplayFormat>> = {
  'beginning-balance': 'eth',
  'eth-acquired': 'eth',
  'staking-rewards': 'eth',
  'ending-balance': 'eth',
  'cumulative-staking-rewards': 'eth',
  'diluted-shares': 'shares',
};

function filedInput(restatement: FiledRestatement, key: RowKey): ComputationInputPayload {
  const value = restatement.rows[key];
  const weekEnd = weekEndInstant(requireDate(restatement.weekEnding));
  return {
    key,
    label: ROW_LABELS[key],
    clock: 'holdings',
    value,
    display: formatDisplay(requireDecimal(value), ROW_FORMATS[key]),
    as_of: toIso(weekEnd),
    sets_as_of: false,
    source: {
      kind: 'exhibit',
      restatement_id: restatement.id,
      accession: restatement.accession,
      sha256: restatement.sha256,
      page: restatement.page,
      row: ROW_LABELS[key],
    },
  };
}

function requireDate(text: string) {
  const parsed = parseDateString(text);
  if (parsed === null) throw new Error('stored date is not a calendar date');
  return parsed;
}

function tickInput(
  key: 'eth-price' | 'share-price',
  label: string,
  clock: ClockKey,
  tick: TickRecord,
): ComputationInputPayload {
  return {
    key,
    label,
    clock,
    value: tick.price,
    display: formatDisplay(requireDecimal(tick.price), 'usd'),
    as_of: toIso(tick.atMs),
    sets_as_of: false,
    source: { kind: 'tick', id: tick.id, at: toIso(tick.atMs) },
  };
}

function officialCloseInput(close: {
  date: string;
  price: string;
  closeInstantMs: number;
}): ComputationInputPayload {
  return {
    key: 'share-price',
    label: `Official close ${close.date}`,
    clock: 'equity',
    value: close.price,
    display: formatDisplay(requireDecimal(close.price), 'usd'),
    as_of: toIso(close.closeInstantMs),
    sets_as_of: false,
    source: { kind: 'official_close', date: close.date },
  };
}

function markAsOf(inputs: ComputationInputPayload[]): string {
  let oldest = inputs[0]?.as_of ?? '';
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const input of inputs) {
    const ms = Date.parse(input.as_of);
    if (ms < oldestMs) {
      oldestMs = ms;
      oldest = input.as_of;
    }
  }
  let flagged = false;
  for (const input of inputs) {
    const isOldest = !flagged && Date.parse(input.as_of) === oldestMs;
    input.sets_as_of = isOldest;
    if (isOldest) flagged = true;
  }
  return oldest;
}

function newComputationId(): string {
  return `cmp_${randomBytes(12).toString('hex')}`;
}

function buildComputation(
  figure: FigureKey,
  value: Decimal,
  format: DisplayFormat,
  inputs: ComputationInputPayload[],
  computedAtMs: number,
  restatementId: string,
): ComputationPayload {
  const asOf = markAsOf(inputs);
  return {
    id: newComputationId(),
    figure,
    label: FIGURE_LABELS[figure],
    value: toFixed(value, COMPUTATION_SCALE),
    display: formatDisplay(value, format),
    as_of: asOf,
    computed_at: toIso(computedAtMs),
    restatement_id: restatementId,
    restated: null,
    inputs,
  };
}

async function insertComputation(
  tx: Transaction,
  computation: ComputationPayload,
  computedAtMs: number,
  asOfMs: number,
): Promise<void> {
  await tx.query(
    `INSERT INTO computations (id, figure, computed_at, restatement_id, value, display, as_of, inputs, restated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NULL)`,
    [
      computation.id,
      computation.figure,
      new Date(computedAtMs),
      computation.restatement_id,
      computation.value,
      computation.display,
      new Date(asOfMs),
      JSON.stringify(computation.inputs),
    ],
  );
}

const THOUSAND = fromInteger(1000n);

function ethHeldOf(restatement: FiledRestatement): {
  value: Decimal;
  inputs: ComputationInputPayload[];
} {
  const inputs = [
    filedInput(restatement, 'beginning-balance'),
    filedInput(restatement, 'eth-acquired'),
    filedInput(restatement, 'staking-rewards'),
  ];
  const value = add(
    add(requireDecimal(restatement.rows['beginning-balance']), requireDecimal(restatement.rows['eth-acquired'])),
    requireDecimal(restatement.rows['staking-rewards']),
  );
  return { value, inputs };
}

interface MnavParts {
  value: Decimal;
  inputs: ComputationInputPayload[];
}

/** mNAV = (share price x diluted shares) / (ending balance x ETH price). */
async function mnavPartsAt(
  tx: Transaction,
  restatement: FiledRestatement,
  atMs: number,
): Promise<MnavParts | null> {
  const ethTick = await latestTickBefore(tx, 'ETH-USD', atMs);
  if (ethTick === null) return null;
  const lastTrade = await lastTradeInSession(tx, atMs);
  let shareInput: ComputationInputPayload;
  if (lastTrade !== null) {
    shareInput = tickInput('share-price', 'Share price \u2014 last trade', 'equity', lastTrade);
  } else {
    const close = await officialCloseAt(tx, atMs);
    if (close === null) return null;
    shareInput = officialCloseInput(close);
  }
  const inputs = [
    filedInput(restatement, 'ending-balance'),
    filedInput(restatement, 'diluted-shares'),
    shareInput,
    tickInput('eth-price', 'ETH price', 'eth', ethTick),
  ];
  const sharePrice = requireDecimal(shareInput.value);
  const dilutedShares = requireDecimal(restatement.rows['diluted-shares']);
  const endingBalance = requireDecimal(restatement.rows['ending-balance']);
  const ethPrice = requireDecimal(ethTick.price);
  const value = divide(
    multiply(sharePrice, dilutedShares),
    multiply(endingBalance, ethPrice),
    COMPUTATION_SCALE,
  );
  return { value, inputs };
}

function asOfMsOf(inputs: ComputationInputPayload[]): number {
  return Math.min(...inputs.map((input) => Date.parse(input.as_of)));
}

/** Stores all four figures for a publication, in tile order. */
export async function storePublicationComputations(
  tx: Transaction,
  restatement: FiledRestatement,
  publishedAtMs: number,
): Promise<ComputationPayload[]> {
  const stored: ComputationPayload[] = [];

  const held = ethHeldOf(restatement);
  stored.push(buildComputation('eth-held', held.value, 'eth', held.inputs, publishedAtMs, restatement.id));

  const cumulativeInputs = [filedInput(restatement, 'cumulative-staking-rewards')];
  stored.push(
    buildComputation(
      'staking-rewards',
      requireDecimal(restatement.rows['cumulative-staking-rewards']),
      'eth',
      cumulativeInputs,
      publishedAtMs,
      restatement.id,
    ),
  );

  const perThousandInputs = [
    filedInput(restatement, 'ending-balance'),
    filedInput(restatement, 'diluted-shares'),
  ];
  const perThousand = divide(
    multiply(requireDecimal(restatement.rows['ending-balance']), THOUSAND),
    requireDecimal(restatement.rows['diluted-shares']),
    COMPUTATION_SCALE,
  );
  stored.push(
    buildComputation(
      'eth-per-1000-diluted',
      perThousand,
      'eth-per-1000',
      perThousandInputs,
      publishedAtMs,
      restatement.id,
    ),
  );

  const mnav = await mnavPartsAt(tx, restatement, publishedAtMs);
  if (mnav !== null) {
    stored.push(
      buildComputation('mnav', mnav.value, 'mnav', mnav.inputs, publishedAtMs, restatement.id),
    );
  }

  for (const computation of stored) {
    await insertComputation(tx, computation, publishedAtMs, asOfMsOf(computation.inputs));
  }
  return stored;
}

/** Stores one mNAV at `atMs`, or nothing when no week has been published. */
export async function storeMnavAt(tx: Transaction, atMs: number): Promise<ComputationPayload | null> {
  const restatement = await currentFiledRestatementAt(tx, atMs);
  if (restatement === null) return null;
  const parts = await mnavPartsAt(tx, restatement, atMs);
  if (parts === null) return null;
  const computation = buildComputation('mnav', parts.value, 'mnav', parts.inputs, atMs, restatement.id);
  await insertComputation(tx, computation, atMs, asOfMsOf(computation.inputs));
  return computation;
}

interface ComputationRow {
  id: string;
  figure: string;
  computed_at: Date;
  restatement_id: string;
  value: string;
  display: string;
  as_of: Date;
  inputs: ComputationInputPayload[];
  restated: RestatedPayload | null;
}

function computationFromRow(row: ComputationRow): ComputationPayload {
  return {
    id: row.id,
    figure: row.figure as FigureKey,
    label: FIGURE_LABELS[row.figure as FigureKey],
    value: row.value,
    display: row.display,
    as_of: toIso(row.as_of.getTime()),
    computed_at: toIso(row.computed_at.getTime()),
    restatement_id: row.restatement_id,
    restated: row.restated,
    inputs: row.inputs,
  };
}

const COMPUTATION_COLUMNS =
  'id, figure, computed_at, restatement_id, value, display, as_of, inputs, restated';

export async function currentComputation(
  tx: Transaction,
  figure: FigureKey,
): Promise<ComputationPayload | null> {
  const rows = await tx.query<ComputationRow>(
    `SELECT ${COMPUTATION_COLUMNS} FROM computations
      WHERE figure = $1 ORDER BY computed_at DESC, seq DESC LIMIT 1`,
    [figure],
  );
  const row = rows[0];
  return row ? computationFromRow(row) : null;
}

export async function computationBefore(
  tx: Transaction,
  figure: FigureKey,
  boundaryMs: number,
): Promise<ComputationPayload | null> {
  const rows = await tx.query<ComputationRow>(
    `SELECT ${COMPUTATION_COLUMNS} FROM computations
      WHERE figure = $1 AND computed_at < $2
      ORDER BY computed_at DESC, seq DESC LIMIT 1`,
    [figure, new Date(boundaryMs)],
  );
  const row = rows[0];
  return row ? computationFromRow(row) : null;
}

export async function computationById(
  tx: Transaction,
  id: string,
): Promise<ComputationPayload | null> {
  const rows = await tx.query<ComputationRow>(
    `SELECT ${COMPUTATION_COLUMNS} FROM computations WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? computationFromRow(row) : null;
}

export async function computationForRestatement(
  tx: Transaction,
  restatementId: string,
  figure: FigureKey,
): Promise<ComputationPayload | null> {
  const rows = await tx.query<ComputationRow>(
    `SELECT ${COMPUTATION_COLUMNS} FROM computations
      WHERE restatement_id = $1 AND figure = $2
      ORDER BY computed_at ASC, seq ASC LIMIT 1`,
    [restatementId, figure],
  );
  const row = rows[0];
  return row ? computationFromRow(row) : null;
}

/**
 * Marks every computation that took its exhibit inputs from the superseded
 * restatement as restated, naming its direct superseder.
 */
export async function markComputationsRestated(
  tx: Transaction,
  supersededRestatementId: string,
  restatedOnDate: string,
  reason: string,
  supersedingRestatementId: string,
  supersedingComputations: readonly ComputationPayload[],
): Promise<void> {
  for (const superseding of supersedingComputations) {
    await tx.query(
      `UPDATE computations
          SET restated = $1::jsonb
        WHERE restatement_id = $2 AND figure = $3 AND restated IS NULL`,
      [
        JSON.stringify({
          on: restatedOnDate,
          reason,
          superseded_by: supersedingRestatementId,
          superseding_computation_id: superseding.id,
        }),
        supersededRestatementId,
        superseding.figure,
      ],
    );
  }
}
