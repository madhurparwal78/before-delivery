/** The cut sheet: rendered only from values recorded at Draw and from the nest of each cut claim, and issued only once the store confirms the bytes. */
import { one, pool, rows, run, transaction, type Queryable } from "./db.js";
import { audit } from "./audit.js";
import { getObject, putObject, sha256Hex, StoreUnavailable } from "./s3.js";
import { byTaken } from "./drawing-state.js";
import { drawingRow, isSealed, loadFact } from "./drawings.js";
import { ruleSetByVersion } from "./rules.js";
import { refuse } from "./errors.js";
import { now } from "./time.js";
import { areaText, lengthText } from "../shared/units.js";
import { roachText } from "../shared/geometry.js";
import { usedDimensions } from "./drawing-state.js";
import type { AccountRow } from "./accounts.js";
import type { Outline, Sail } from "../shared/types.js";

export interface SheetInput {
  code: string;
  boatName: string;
  sail: Sail;
  ownerName: string;
  cloth: { code: string; name: string; usableWidthMm: number };
  dimensions: { key: string; mm: number }[];
  areaMm2: number;
  roachPermille: number;
  rule: { version: number; toleranceMm: number; seamOverlapMm: number };
  panels: { number: number; outline: Outline; lengthMm: number; widthMm: number; areaMm2: number }[];
  nests: { stockCode: string; usedMm: number; widthMm: number; usableWidthMm: number; lot: string; lays: { outline: Outline }[] }[];
  predecessor: string | null;
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const INK = "#111111";
const GROUND = "#F4EFE6";
const COBALT = "#1D3FD6";
const BLACK = "#0B0B0C";
const TOMATO = "#FF5A3C";

const SHEET_WIDTH = 1200;
const MARGIN = 40;
const LINE_HEIGHT = 22;

export function renderSheet(input: SheetInput): Buffer {
  const tail = `tolerance ±${input.rule.toleranceMm} mm · rule set v${input.rule.version}`;
  const sailName = input.sail === "mainsail" ? "Mainsail" : "Headsail";
  const formula = input.sail === "mainsail" ? `P × E / 2 × ${roachText(input.roachPermille)}` : "LP × LL / 2";
  const lines: string[] = [
    `Cut sheet ${input.code} · ${input.boatName} · ${sailName} · ${input.ownerName}`,
    `Cloth ${input.cloth.code} ${input.cloth.name} · usable width ${lengthText(input.cloth.usableWidthMm)} · catalogue width, ${tail}`,
    ...input.dimensions.map((dimension) => `${dimension.key} ${lengthText(dimension.mm)} · tape, ${tail}`),
    `Sail area ${areaText(input.areaMm2)} · ${formula} · ${tail}`,
    ...input.panels.map(
      (panel) =>
        `Panel ${panel.number} · ${lengthText(panel.lengthMm)} × ${lengthText(panel.widthMm)} · ${areaText(panel.areaMm2)} · crosscut perpendicular to leech, seam overlap ${input.rule.seamOverlapMm} mm · ${tail}`,
    ),
  ];
  const body: string[] = [];
  lines.forEach((line, index) => {
    const size = index === 0 ? 20 : 14;
    body.push(`<text x="${MARGIN}" y="${MARGIN + 8 + index * LINE_HEIGHT}" font-size="${size}" font-weight="${index === 0 ? 700 : 400}">${escapeXml(line)}</text>`);
  });
  let cursor = MARGIN + 8 + lines.length * LINE_HEIGHT + 24;

  for (const nest of input.nests) {
    const nestLine = `Nest on ${nest.stockCode} · ${lengthText(nest.usedMm)} of ${lengthText(nest.widthMm)} cloth · thread along the roll · lot ${nest.lot} · ${tail}`;
    body.push(`<text x="${MARGIN}" y="${cursor}" font-size="14" font-weight="700">${escapeXml(nestLine)}</text>`);
    cursor += 12;
    const scale = (SHEET_WIDTH - 2 * MARGIN) / Math.max(1, nest.usedMm);
    const height = Math.max(24, Math.round(nest.usableWidthMm * scale));
    body.push(`<rect x="${MARGIN}" y="${cursor}" width="${SHEET_WIDTH - 2 * MARGIN}" height="${height}" fill="${BLACK}"/>`);
    for (const lay of nest.lays) {
      const points = lay.outline.map(([x, y]) => `${Math.round(MARGIN + x * scale)},${Math.round(cursor + y * scale)}`).join(" ");
      body.push(`<polygon points="${points}" fill="${GROUND}" stroke="${TOMATO}" stroke-width="1"/>`);
    }
    cursor += height + 36;
  }
  if (input.predecessor) {
    body.push(`<text x="${MARGIN}" y="${cursor}" font-size="14">${escapeXml(`Supersedes ${input.predecessor}`)}</text>`);
    cursor += 24;
  }
  const height = cursor + MARGIN - 16;
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${height}" viewBox="0 0 ${SHEET_WIDTH} ${height}" font-family="Helvetica, Arial, sans-serif" fill="${INK}">`,
    `<title>Cut sheet ${escapeXml(input.code)}</title>`,
    `<rect width="${SHEET_WIDTH}" height="${height}" fill="${GROUND}"/>`,
    `<rect x="0" y="0" width="${SHEET_WIDTH}" height="6" fill="${COBALT}"/>`,
    ...body,
    `</svg>`,
    ``,
  ].join("\n");
  return Buffer.from(svg, "utf8");
}

async function loadSheetInput(db: Queryable, code: string): Promise<SheetInput> {
  const at = now();
  const facts = (await loadFact(db, code, at))!;
  const row = facts.row;
  const rule = await ruleSetByVersion(db, row.ruleset_version);
  const cloth = (await one<{ code: string; name: string; usable_width_mm: number }>(db, "SELECT code, name, usable_width_mm FROM cloth WHERE code = $1", [row.cloth_code]))!;
  const used = usedDimensions(row.sail);
  const recorded = row.recorded_dims as Record<string, number>;
  const cutClaims = facts.claims.filter((claim) => claim.status === "cut").sort(byTaken);
  const nests = [];
  for (const claim of cutClaims) {
    const stock = (await one<{ width_mm: number; usable_width_mm: number; lot: string }>(db, "SELECT width_mm, usable_width_mm, lot FROM stock WHERE code = $1", [claim.stock_code]))!;
    const claimRecord = (await one<{ used_mm: number }>(db, "SELECT used_mm FROM claim WHERE id = $1", [claim.id]))!;
    nests.push({
      stockCode: claim.stock_code,
      usedMm: claimRecord.used_mm,
      widthMm: stock.width_mm,
      usableWidthMm: stock.usable_width_mm,
      lot: stock.lot,
      lays: facts.lays.filter((lay) => lay.claim_id === claim.id).sort((a, b) => a.panel_number - b.panel_number).map((lay) => ({ outline: lay.outline })),
    });
  }
  return {
    code,
    boatName: row.recorded_boat_name,
    sail: row.sail,
    ownerName: row.recorded_owner_name,
    cloth: { code: cloth.code, name: cloth.name, usableWidthMm: cloth.usable_width_mm },
    dimensions: [used.luff, used.foot].map((key) => ({ key, mm: recorded[key]! })),
    areaMm2: row.area_mm2,
    roachPermille: rule.roach_permille,
    rule: { version: rule.version, toleranceMm: rule.tolerance_mm, seamOverlapMm: rule.seam_overlap_mm },
    panels: facts.panels.map((panel) => ({ number: panel.number, outline: panel.outline, lengthMm: panel.length_mm, widthMm: panel.width_mm, areaMm2: panel.area_mm2 })),
    nests,
    predecessor: row.predecessor,
  };
}

export const sheetKey = (code: string, sha: string): string => `cut-sheets/${code}/${sha}.svg`;

/** True only when the bytes read back from the key have the rendered length and a SHA-256 equal to the render's. */
export async function storeConfirms(key: string, bytes: Buffer): Promise<boolean> {
  const sha = sha256Hex(bytes);
  const matches = (found: { body: Buffer } | null): boolean => found !== null && found.body.length === bytes.length && sha256Hex(found.body) === sha;
  try {
    if (matches(await getObject(key))) return true;
    await putObject(key, bytes, "image/svg+xml");
    return matches(await getObject(key));
  } catch (error) {
    if (error instanceof StoreUnavailable) return false;
    throw error;
  }
}

export async function previewSheet(db: Queryable, code: string): Promise<Buffer> {
  const facts = (await loadFact(db, code, now()))!;
  if (!["cut", "pending_store", "issued"].includes(facts.derived.status)) throw refuse("wrong_state");
  return renderSheet(await loadSheetInput(db, code));
}

export async function issueDrawing(actor: AccountRow, code: string): Promise<"issued" | "pending_store"> {
  return transaction(async (db) => {
    await drawingRow(db, code, true);
    const facts = (await loadFact(db, code, now()))!;
    if (isSealed(facts)) throw refuse("already_issued");
    if (facts.derived.status !== "cut") throw refuse("wrong_state");
    const bytes = renderSheet(await loadSheetInput(db, code));
    const sha = sha256Hex(bytes);
    const key = sheetKey(code, sha);
    const phase = (await storeConfirms(key, bytes)) ? "issued" : "pending_store";
    await run(db, "UPDATE drawing SET phase = $2, cut_sheet_sha = $3, cut_sheet_size = $4, cut_sheet_key = $5 WHERE code = $1", [code, phase, sha, bytes.length, key]);
    await audit(db, { actor: actor.email, action: "drawing.issue", target: code, before: "cut", after: phase });
    return phase;
  });
}

/** Every instance retries each Pending store drawing the same way Issue confirms; no audit row, nobody asked. */
export async function retryPendingStore(): Promise<void> {
  const pending = await rows<{ code: string }>(pool, "SELECT code FROM drawing WHERE phase = 'pending_store'");
  for (const { code } of pending) {
    await transaction(async (db) => {
      const locked = await one<{ code: string }>(db, "SELECT code FROM drawing WHERE code = $1 AND phase = 'pending_store' FOR UPDATE SKIP LOCKED", [code]);
      if (!locked) return;
      const bytes = renderSheet(await loadSheetInput(db, code));
      const key = sheetKey(code, sha256Hex(bytes));
      if (await storeConfirms(key, bytes)) await run(db, "UPDATE drawing SET phase = 'issued' WHERE code = $1", [code]);
    });
  }
}
