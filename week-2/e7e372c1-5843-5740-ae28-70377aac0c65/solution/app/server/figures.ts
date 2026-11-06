// The four figures: their inputs, exact values, display strings and as-of. Pure; no database.

import {
  divideFractions,
  formatEth,
  formatMnav,
  formatPerThousand,
  formatShares,
  formatUsd,
  fractionOf,
  multiplyFractions,
  requireDecimal,
  storeFraction,
  type Fraction,
} from "../shared/decimal.ts";
import {
  FIGURE_LABELS,
  ROW_KEYS,
  ROW_LABELS,
  type ComputationExhibit,
  type ComputationInput,
  type FigureKey,
  type RowKey,
} from "../shared/domain.ts";
import { formatInstant } from "../shared/newyork.ts";

export interface Holdings {
  restatementId: string;
  accession: string;
  sha256: string;
  page: number;
  /** Sunday 23:59:59 of the holdings week. */
  weekEndInstant: number;
  rows: Record<RowKey, string>;
}

export type SharePrice =
  | { kind: "tick"; id: string; price: string; at: number }
  | { kind: "official_close"; date: string; price: string; closeAt: number };

export interface EthTick {
  id: string;
  price: string;
  at: number;
}

interface FigureInputs {
  holdings: Holdings;
  sharePrice: SharePrice;
  ethTick: EthTick;
}

/** A computation before it is stored: instants are epoch milliseconds. */
export interface FigureResult {
  figure: FigureKey;
  label: string;
  value: string;
  display: string;
  asOf: number;
  inputs: Array<ComputationInput & { asOfInstant: number }>;
  exhibit: ComputationExhibit;
}

type InputKey = RowKey | "share-price" | "eth-price";

const INPUT_ORDER: Record<FigureKey, readonly InputKey[]> = {
  "eth-held": ["beginning-balance", "eth-acquired", "staking-rewards"],
  "staking-rewards": ["cumulative-staking-rewards"],
  "eth-per-1000-diluted": ["ending-balance", "diluted-shares"],
  mnav: ["ending-balance", "diluted-shares", "share-price", "eth-price"],
};

function rowKeyOf(key: InputKey): RowKey {
  const row = ROW_KEYS.find((candidate) => candidate === key);
  if (!row) throw new RangeError("not a row input");
  return row;
}

function rowDisplay(key: RowKey, value: string): string {
  return key === "diluted-shares" ? formatShares(value) : formatEth(value);
}

function exhibitInput(key: RowKey, holdings: Holdings): ComputationInput & { asOfInstant: number } {
  const value = holdings.rows[key];
  return {
    key,
    label: ROW_LABELS[key],
    clock: "holdings",
    value,
    display: rowDisplay(key, value),
    as_of: formatInstant(holdings.weekEndInstant),
    asOfInstant: holdings.weekEndInstant,
    sets_as_of: false,
    source: {
      kind: "exhibit",
      restatement_id: holdings.restatementId,
      accession: holdings.accession,
      sha256: holdings.sha256,
      page: holdings.page,
      row: ROW_LABELS[key],
    },
  };
}

function sharePriceInput(price: SharePrice): ComputationInput & { asOfInstant: number } {
  const lastTrade = price.kind === "tick";
  const asOfInstant = price.kind === "tick" ? price.at : price.closeAt;
  return {
    key: "share-price",
    label: price.kind === "tick" ? "Share price — last trade" : `Official close ${price.date}`,
    clock: "equity",
    value: price.price,
    display: formatUsd(price.price),
    as_of: formatInstant(asOfInstant),
    asOfInstant,
    sets_as_of: false,
    source: lastTrade ? { kind: "tick", id: price.id, at: formatInstant(price.at) } : { kind: "official_close", date: price.date },
  };
}

function ethPriceInput(tick: EthTick): ComputationInput & { asOfInstant: number } {
  return {
    key: "eth-price",
    label: "ETH price",
    clock: "eth",
    value: tick.price,
    display: formatUsd(tick.price),
    as_of: formatInstant(tick.at),
    asOfInstant: tick.at,
    sets_as_of: false,
    source: { kind: "tick", id: tick.id, at: formatInstant(tick.at) },
  };
}

function value(inputs: Map<string, string>, key: string): Fraction {
  return fractionOf(requireDecimal(inputs.get(key) ?? "0"));
}

function sum(fractions: Fraction[]): Fraction {
  const denominator = fractions.reduce((total, f) => total * f.denominator, 1n);
  const numerator = fractions.reduce((total, f) => total + f.numerator * (denominator / f.denominator), 0n);
  return { numerator, denominator };
}

function figureValue(figure: FigureKey, inputs: Map<string, string>): Fraction | null {
  switch (figure) {
    case "eth-held":
      return sum(INPUT_ORDER[figure].map((key) => value(inputs, key)));
    case "staking-rewards":
      return value(inputs, "cumulative-staking-rewards");
    case "eth-per-1000-diluted":
      return multiplyFractions(divideFractions(value(inputs, "ending-balance"), value(inputs, "diluted-shares")), { numerator: 1000n, denominator: 1n });
    case "mnav": {
      const denominator = multiplyFractions(value(inputs, "ending-balance"), value(inputs, "eth-price"));
      if (denominator.numerator === 0n) return null;
      return divideFractions(multiplyFractions(value(inputs, "share-price"), value(inputs, "diluted-shares")), denominator);
    }
  }
}

function displayOf(figure: FigureKey, stored: string): string {
  if (figure === "eth-per-1000-diluted") return formatPerThousand(stored);
  return figure === "mnav" ? formatMnav(stored) : formatEth(stored);
}

/** The computation's as-of is the oldest as-of among its inputs; the first input holding that instant sets it. */
function settleAsOf<T extends { asOfInstant: number; sets_as_of: boolean }>(inputs: T[]): number {
  const oldest = Math.min(...inputs.map((input) => input.asOfInstant));
  const first = inputs.find((input) => input.asOfInstant === oldest);
  for (const input of inputs) input.sets_as_of = input === first;
  return oldest;
}

function exhibitOf(holdings: Holdings): ComputationExhibit {
  return {
    accession: holdings.accession,
    sha256: holdings.sha256,
    page: holdings.page,
    rows: ROW_KEYS.map((key) => ({
      key,
      label: ROW_LABELS[key],
      value: holdings.rows[key],
      display: rowDisplay(key, holdings.rows[key]),
    })),
  };
}

/** Null only when the figure is undefined (an mNAV over an empty treasury). */
export function computeFigure(figure: FigureKey, source: FigureInputs): FigureResult | null {
  const built = INPUT_ORDER[figure].map((key) => {
    if (key === "share-price") return sharePriceInput(source.sharePrice);
    if (key === "eth-price") return ethPriceInput(source.ethTick);
    return exhibitInput(rowKeyOf(key), source.holdings);
  });
  const values = new Map(built.map((input) => [input.key, input.value]));
  const exact = figureValue(figure, values);
  if (exact === null) return null;
  const stored = storeFraction(exact);
  const asOf = settleAsOf(built);
  return { figure, label: FIGURE_LABELS[figure], value: stored, display: displayOf(figure, stored), asOf, inputs: built, exhibit: exhibitOf(source.holdings) };
}
