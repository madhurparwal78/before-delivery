import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { displayAmount, displayHealth, displaySigned, deskWall } from "../shared/format.js";
import type { LegJson } from "./ledger.js";

// The published settlement statement: nine groups of lines, in order, in desk format. The text statement and the
// PDF carry the same lines.

export type SettlementKind = "draw" | "withdrawal" | "liquidation";

const KIND_LABEL: Record<SettlementKind, string> = { draw: "Draw", withdrawal: "Liquidity withdrawal", liquidation: "Liquidation" };

export interface StatementFacts {
  settlementId: string;
  kind: SettlementKind;
  member: { name: string; actorId: string };
  asset: string;
  amount: bigint;
  createdAt: string;
  legs: LegJson[];
  /** The amounts of a liquidation, with the collateral and the health factors around it. */
  liquidation?: {
    collateralAsset: string;
    repaid: bigint;
    seized: bigint;
    bonusAmount: bigint;
    writtenOff: bigint;
    healthFactorBefore: string | null;
    healthFactorAfter: string | null;
  };
}

export function statementLines(facts: StatementFacts, decimalsOf: (asset: string) => number): string[] {
  const money = (amount: bigint, asset: string) => `${displayAmount(amount, decimalsOf(asset))} ${asset}`;
  const lines = [
    "Quillmoor Reserve settlement statement",
    `Settlement ${facts.settlementId}`,
    `Kind ${KIND_LABEL[facts.kind]}`,
    `Member ${facts.member.name} (${facts.member.actorId})`,
    `Amount ${money(facts.amount, facts.asset)}`,
  ];
  const fill = facts.liquidation;
  if (fill) {
    lines.push(
      `Repaid ${money(fill.repaid, facts.asset)}`,
      `Seized ${money(fill.seized, fill.collateralAsset)}`,
      `Bonus ${money(fill.bonusAmount, fill.collateralAsset)}`,
      `Written off ${money(fill.writtenOff, facts.asset)}`,
      `Health factor before ${displayHealth(fill.healthFactorBefore)}`,
      `Health factor after ${displayHealth(fill.healthFactorAfter)}`,
    );
  }
  lines.push(`Desk time ${deskWall(facts.createdAt, config.deskTimeZone, true)}`, `UTC ${facts.createdAt}`);
  for (const leg of facts.legs) lines.push(`${leg.account} ${leg.asset} ${displaySigned(leg.amount, decimalsOf(leg.asset))}`);
  return lines;
}

/** The text statement: UTF-8, every line ending in a line feed. */
export function statementText(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

const CLIENT_ROOT = fileURLToPath(new URL("../../client/", import.meta.url));
const FONTS = [
  { file: "ibm-plex-mono-latin-400-normal", family: "IBM Plex Mono", weight: 400 },
  { file: "space-grotesk-latin-600-normal", family: "Space Grotesk", weight: 600 },
];

async function fontFaces(): Promise<string> {
  const built = await readdir(`${CLIENT_ROOT}assets`).catch(() => []);
  const faces: string[] = [];
  for (const { file, family, weight } of FONTS) {
    const name = built.find((entry) => entry.startsWith(file) && entry.endsWith(".woff2"));
    if (!name) continue;
    const data = (await readFile(`${CLIENT_ROOT}assets/${name}`)).toString("base64");
    faces.push(`@font-face{font-family:"${family}";font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2")}`);
  }
  return faces.join("\n");
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The statement as a ledger-sheet page for the PDF renderer: ruled lines of tabular mono on warm paper. */
export async function statementHtml(lines: string[]): Promise<string> {
  const [title = "", ...rest] = lines;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
${await fontFaces()}
@page{size:A4;margin:18mm 16mm}
body{margin:0;background:#faf6ea;color:#1a2130;font:10pt/1.5 "IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
h1{margin:0 0 6mm;padding-bottom:3mm;border-bottom:2px solid #1a2130;font:600 17pt "Space Grotesk",sans-serif}
p{margin:0;padding:1.4mm 0;border-bottom:.5pt solid #c9bd98;white-space:pre}
</style></head><body>
<h1>${escapeHtml(title)}</h1>
${rest.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
</body></html>`;
}
