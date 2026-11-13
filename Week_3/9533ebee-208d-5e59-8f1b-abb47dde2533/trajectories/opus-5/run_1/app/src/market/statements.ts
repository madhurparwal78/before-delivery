/**
 * Settlement statements. The text statement holds the published lines in
 * order, with amounts in desk format and the settlement instant both in the
 * desk time zone with its abbreviation and in UTC. The PDF shows the same
 * lines in the same order, set in the ledger-sheet type.
 */

import { config } from '../config.ts';
import { assetDecimals, type Asset } from '../domain/assets.ts';
import { apiHealthFactor } from '../domain/apiformat.ts';
import { formatAmount, formatHealthFactor, formatSignedAmount } from '../domain/deskformat.ts';
import { formatCanonicalUtc, formatWallDateTime } from '../domain/desktime.ts';
import type { Leg } from '../ledger/postings.ts';

export type SettlementKind = 'draw' | 'withdrawal' | 'liquidation';

const KIND_LABEL: Readonly<Record<SettlementKind, string>> = {
  draw: 'Draw',
  withdrawal: 'Liquidity withdrawal',
  liquidation: 'Liquidation',
};

export interface LiquidationStatementFigures {
  readonly repaid: bigint;
  readonly debtAsset: Asset;
  readonly seized: bigint;
  readonly collateralAsset: Asset;
  readonly bonusAmount: bigint;
  readonly writtenOff: bigint;
  readonly healthFactorBeforeScaled: bigint | null;
  readonly healthFactorAfterScaled: bigint | null;
}

export interface StatementInput {
  readonly settlementId: string;
  readonly kind: SettlementKind;
  readonly memberName: string;
  readonly actorId: string;
  readonly asset: Asset;
  readonly amount: bigint;
  readonly createdAtMs: number;
  readonly legs: readonly Leg[];
  readonly liquidation: LiquidationStatementFigures | null;
}

/** The statement's lines, in the published order. */
export function statementLines(input: StatementInput): string[] {
  const lines = [
    'Quillmoor Reserve settlement statement',
    `Settlement ${input.settlementId}`,
    `Kind ${KIND_LABEL[input.kind]}`,
    `Member ${input.memberName} (${input.actorId})`,
    `Amount ${formatAmount(input.amount, assetDecimals(input.asset))} ${input.asset}`,
  ];

  const fill = input.liquidation;
  if (fill !== null) {
    const collateralDecimals = assetDecimals(fill.collateralAsset);
    const debtDecimals = assetDecimals(fill.debtAsset);
    lines.push(
      `Repaid ${formatAmount(fill.repaid, debtDecimals)} ${fill.debtAsset}`,
      `Seized ${formatAmount(fill.seized, collateralDecimals)} ${fill.collateralAsset}`,
      `Bonus ${formatAmount(fill.bonusAmount, collateralDecimals)} ${fill.collateralAsset}`,
      `Written off ${formatAmount(fill.writtenOff, debtDecimals)} ${fill.debtAsset}`,
      `Health factor before ${formatHealthFactor(apiHealthFactor(fill.healthFactorBeforeScaled))}`,
      `Health factor after ${formatHealthFactor(apiHealthFactor(fill.healthFactorAfterScaled))}`,
    );
  }

  lines.push(
    `Desk time ${formatWallDateTime(input.createdAtMs, config.deskTimeZone)}`,
    `UTC ${formatCanonicalUtc(input.createdAtMs)}`,
  );

  for (const leg of input.legs) {
    lines.push(
      `${leg.account} ${leg.asset} ${formatSignedAmount(leg.amount, assetDecimals(leg.asset))}`,
    );
  }

  return lines;
}

/** The text statement: UTF-8, each line ending in a line feed. */
export function statementText(input: StatementInput): string {
  return `${statementLines(input).join('\n')}\n`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The statement as a ledger sheet for the renderer: the same lines in the
 * same order, in tabular monospace on hairline rules.
 */
export function statementHtml(input: StatementInput): string {
  const rows = statementLines(input)
    .map((line) => `<div class="line">${escapeHtml(line)}</div>`)
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Quillmoor Reserve settlement ${escapeHtml(input.settlementId)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  html { font-size: 11pt; }
  body {
    margin: 0;
    background: #fdfbf4;
    color: #15161c;
    font-family: "IBM Plex Mono", "DejaVu Sans Mono", monospace;
    font-variant-numeric: tabular-nums;
  }
  h1 {
    font-family: "DejaVu Sans", sans-serif;
    font-size: 1.25rem;
    margin: 0 0 8mm;
    padding-bottom: 2mm;
    border-bottom: 1.5pt solid #15161c;
    letter-spacing: 0.01em;
  }
  .line {
    padding: 1.4mm 0;
    border-bottom: 0.4pt solid #b3ad8e;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .line:last-child { border-bottom: none; }
</style>
</head>
<body>
<h1>Quillmoor Reserve</h1>
${rows}
</body>
</html>`;
}

export const statementJsonKey = (kind: SettlementKind, settlementId: string): string =>
  `statements/${kind}/${settlementId}.json`;
export const statementTextKey = (kind: SettlementKind, settlementId: string): string =>
  `statements/${kind}/${settlementId}.txt`;
export const statementPdfKey = (kind: SettlementKind, settlementId: string): string =>
  `statements/${kind}/${settlementId}.pdf`;
