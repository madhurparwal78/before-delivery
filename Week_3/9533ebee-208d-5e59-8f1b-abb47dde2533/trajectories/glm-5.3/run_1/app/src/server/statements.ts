import type { AssetCode, Leg } from '../shared/types.js';
import { deskAmount, deskDateTime, deskHealthFactor } from '../shared/deskFormat.js';
import { ASSETS } from '../shared/assets.js';

export interface StatementInput {
  settlement_id: string;
  kind: 'draw' | 'withdrawal' | 'liquidation';
  actor_id: string;
  actor_name: string;
  position_id: string | null;
  asset: AssetCode;
  amount: bigint;
  legs: Leg[];
  created_at: Date;
  liquidation?: {
    repaid: bigint;
    seized: bigint;
    bonus_amount: bigint;
    written_off: bigint;
    health_factor_before: bigint | null;
    health_factor_after: bigint | null;
    collateral_asset: AssetCode;
    debt_asset: AssetCode;
  };
  withdrawal?: {
    shares_burned: bigint;
    share_price_after: string;
  };
  draw?: {
    debt_after: bigint;
    health_factor_after: bigint | null;
    state_after: string;
  };
}

const KIND_LABELS: Record<'draw' | 'withdrawal' | 'liquidation', string> = {
  draw: 'Draw',
  withdrawal: 'Liquidity withdrawal',
  liquidation: 'Liquidation',
};

export function deskLegAmount(amount: string, asset: AssetCode): string {
  const value = BigInt(amount);
  return deskAmount(value, ASSETS[asset].decimals, true);
}

export function statementLines(input: StatementInput, timeZone: string): string[] {
  const decimals = ASSETS[input.asset].decimals;
  const lines: string[] = [
    'Quillmoor Reserve settlement statement',
    `Settlement ${input.settlement_id}`,
    `Kind ${KIND_LABELS[input.kind]}`,
    `Member ${input.actor_name} (${input.actor_id})`,
    `Amount ${deskAmount(input.amount, decimals, false)} ${input.asset}`,
  ];
  if (input.kind === 'liquidation' && input.liquidation !== undefined) {
    const liq = input.liquidation;
    const debtDecimals = ASSETS[liq.debt_asset].decimals;
    const collateralDecimals = ASSETS[liq.collateral_asset].decimals;
    lines.push(
      `Repaid ${deskAmount(liq.repaid, debtDecimals, false)} ${liq.debt_asset}`,
      `Seized ${deskAmount(liq.seized, collateralDecimals, false)} ${liq.collateral_asset}`,
      `Bonus ${deskAmount(liq.bonus_amount, collateralDecimals, false)} ${liq.collateral_asset}`,
      `Written off ${deskAmount(liq.written_off, debtDecimals, false)} ${liq.debt_asset}`,
      `Health factor before ${deskHealthFactor(liq.health_factor_before)}`,
      `Health factor after ${deskHealthFactor(liq.health_factor_after)}`,
    );
  }
  lines.push(`Desk time ${deskDateTime(input.created_at, timeZone)}`);
  lines.push(`UTC ${input.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z')}`);
  for (const leg of input.legs) {
    lines.push(`${leg.account} ${leg.asset} ${deskLegAmount(leg.amount, leg.asset)}`);
  }
  return lines;
}

export function statementText(input: StatementInput, timeZone: string): string {
  return statementLines(input, timeZone).map((line): string => line + '\n').join('');
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export interface FontFaces {
  mono: { name: string; file: string; fileBold: string };
  sans: { name: string; file: string; fileBold: string };
  grotesk: { name: string; file: string; fileBold: string };
}

export function statementHtml(input: StatementInput, timeZone: string, fonts: FontFaces): string {
  const lines = statementLines(input, timeZone);
  const rows = lines.map((line): string => `<div class="line">${escapeHtml(line)}</div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Quillmoor Reserve settlement statement</title>
<style>
@font-face { font-family: "PlexMono"; src: url("/fonts/${fonts.mono.file}"); font-weight: 400; }
@font-face { font-family: "PlexMono"; src: url("/fonts/${fonts.mono.fileBold}"); font-weight: 700; }
@font-face { font-family: "PlexSans"; src: url("/fonts/${fonts.sans.file}"); font-weight: 400; }
@font-face { font-family: "PlexSans"; src: url("/fonts/${fonts.sans.fileBold}"); font-weight: 700; }
@font-face { font-family: "SpaceGrotesk"; src: url("/fonts/${fonts.grotesk.file}"); font-weight: 400; }
@font-face { font-family: "SpaceGrotesk"; src: url("/fonts/${fonts.grotesk.fileBold}"); font-weight: 700; }
body { font-family: "PlexMono", monospace; margin: 0; padding: 28px 32px; color: #16232e; background: #faf7ef; font-size: 11pt; line-height: 1.7; }
.line { border-bottom: 0.4pt solid #d8cfb8; padding: 2pt 0; white-space: pre; }
h1 { font-family: "SpaceGrotesk", sans-serif; font-size: 16pt; margin: 0 0 10pt; border-bottom: 1.2pt solid #16232e; padding-bottom: 6pt; }
</style></head><body><h1>Quillmoor Reserve settlement statement</h1>${rows}</body></html>`;
}
