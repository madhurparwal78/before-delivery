// The single decision point for display rounding and the display formats.

import { Decimal, groupIntPart } from "./decimal.js";

/** Round half away from zero from an 18-digit stored value to the display format. */
export function roundForDisplay(value: string, decimals: number): string {
  const d = Decimal.fromString(value);
  if (!d) throw new Error("bad stored value");
  return d.round(decimals).toFixed(decimals);
}

function grouped(value: string, decimals: number): string {
  const rounded = roundForDisplay(value, decimals);
  const dot = rounded.indexOf(".");
  const intPart = dot === -1 ? rounded : rounded.slice(0, dot);
  const fracPart = dot === -1 ? "" : rounded.slice(dot + 1);
  const groupedInt = groupIntPart(intPart);
  return fracPart ? `${groupedInt}.${fracPart}` : groupedInt;
}

/** ETH amounts: three decimals plus " ETH". */
export function displayEth(value: string): string {
  return `${grouped(value, 3)} ETH`;
}

/** ETH per 1,000 diluted shares: four decimals, no suffix. */
export function displayEthPer1000(value: string): string {
  return grouped(value, 4);
}

/** mNAV: three decimals immediately followed by ×. */
export function displayMnav(value: string): string {
  return `${grouped(value, 3)}×`;
}

/** USD: $ then two decimals. */
export function displayUsd(value: string): string {
  return `$${grouped(value, 2)}`;
}

/** Share counts: whole numbers with separators. */
export function displayShares(value: string): string {
  return groupIntPart(Decimal.fromString(value)?.toFixed(0) ?? value);
}

export type FigureKey = "eth-held" | "staking-rewards" | "eth-per-1000-diluted" | "mnav";

export function displayForFigure(figure: FigureKey, value: string): string {
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

export const FIGURE_LABELS: Record<FigureKey, string> = {
  "eth-held": "Total ETH held",
  "staking-rewards": "Cumulative staking rewards",
  "eth-per-1000-diluted": "ETH per 1,000 diluted shares",
  mnav: "mNAV",
};

export const FIGURE_ORDER: FigureKey[] = ["eth-held", "staking-rewards", "eth-per-1000-diluted", "mnav"];
