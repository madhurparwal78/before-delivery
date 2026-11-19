/** The seeded loft, applied exactly once per database under the database-wide lock. */
import type pg from "pg";
import { one, run, type Queryable } from "./db.js";
import { SCHEMA } from "./schema.js";
import { ensureBucket, putObject, sha256Hex, StoreUnavailable } from "./s3.js";
import { renderSheet, sheetKey, storeConfirms, type SheetInput } from "./sheets.js";
import { autoPosition, buildPanels, headsailArea, mainsailArea, outlineExtent, placeOutline, roachText } from "../shared/geometry.js";
import {
  ACCOUNTS,
  CLOSURES,
  CLOTHS,
  OFFCUTS,
  ROLLS,
  RULE_SETS,
  SEED_BOATS,
  SUBMISSION_SEQUENCES,
  type SeedBoat,
} from "./seed-data.js";
import type { DimensionKey, Outline } from "../shared/types.js";

const SEED_LOCK = 7_314_001;
const ACTOR = "morwenna@tabling.example";
const FOUR_HOURS = 4 * 3600 * 1000;

async function bulk(db: Queryable, table: string, columns: string[], data: unknown[][]): Promise<void> {
  const chunk = Math.max(1, Math.floor(30000 / columns.length));
  for (let start = 0; start < data.length; start += chunk) {
    const slice = data.slice(start, start + chunk);
    const marks = slice.map((_, r) => `(${columns.map((_c, c) => `$${r * columns.length + c + 1}`).join(", ")})`).join(", ");
    await run(db, `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${marks}`, slice.flat());
  }
}

interface DrawingPlan {
  num: number;
  code: string;
  boat: SeedBoat;
  sail: "mainsail" | "headsail";
  cloth: string;
  phase: "measuring" | "drawn" | "pending_store" | "issued";
  rulesetVersion: number | null;
  assignedTo: string | null;
}

function planDrawings(): DrawingPlan[] {
  const plans: DrawingPlan[] = [];
  for (let n = 1; n <= 240; n++) {
    const boatNumber = n <= 230 ? ((n - 1) % 10) + 1 : n <= 235 ? 11 : 12;
    const sail = n > 230 || n % 2 === 1 ? "mainsail" : "headsail";
    let cloth = sail === "mainsail" ? "C-07" : "C-06";
    if (n >= 141 && n <= 150) cloth = "C-18";
    const phase = n <= 60 ? "issued" : n <= 70 ? "pending_store" : n <= 190 ? "drawn" : "measuring";
    plans.push({
      num: n,
      code: `BR-${String(n).padStart(4, "0")}`,
      boat: SEED_BOATS[boatNumber - 1]!,
      sail,
      cloth,
      phase,
      rulesetVersion: n <= 30 ? 2 : n <= 190 ? 3 : null,
      assignedTo: n >= 131 && n <= 150 ? "A-02" : null,
    });
  }
  return plans;
}

const at = (iso: string): Date => new Date(iso);

export async function applySchemaAndSeed(client: pg.PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_lock($1)", [SEED_LOCK]);
  try {
    await client.query(SCHEMA);
    if (await one(client, "SELECT 1 FROM meta WHERE key = 'seeded'")) return;
    await seed(client);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SEED_LOCK]);
  }
}

async function seed(db: pg.PoolClient): Promise<void> {
  const storeReachable = await ensureBucket().then(() => true, (error) => (error instanceof StoreUnavailable ? false : Promise.reject(error)));
  const clothByCode = new Map(CLOTHS.map((cloth) => [cloth.code, cloth]));
  const ruleByVersion = new Map(RULE_SETS.map((rule) => [rule.version, rule]));
  const plans = planDrawings();

  // ---- drawings built in memory so the 70 cut sheets can be rendered and stored before the transaction
  const panelRows: unknown[][] = [];
  const claimRows: unknown[][] = [];
  const layRows: unknown[][] = [];
  const drawingRows: unknown[][] = [];
  const sheets: { code: string; bytes: Buffer; key: string; sha: string }[] = [];
  let claimNumber = 0;

  for (const plan of plans) {
    const cloth = clothByCode.get(plan.cloth)!;
    const isDrawn = plan.phase !== "measuring";
    const used: [DimensionKey, DimensionKey] = plan.sail === "mainsail" ? ["P", "E"] : ["LL", "LP"];
    const luff = plan.boat.dims[used[0]];
    const foot = plan.boat.dims[used[1]];
    const rule = plan.rulesetVersion ? ruleByVersion.get(plan.rulesetVersion)! : null;
    let areaMm2: number | null = null;
    let basis: string | null = null;
    let sheet: { sha: string; size: number; key: string } | null = null;
    if (isDrawn && rule) {
      areaMm2 = plan.sail === "mainsail" ? mainsailArea(luff, foot, rule.roach) : headsailArea(foot, luff);
      const formula = plan.sail === "mainsail" ? `P × E / 2 × ${roachText(rule.roach)}` : "LP × LL / 2";
      basis = `${formula} · tolerance ±${rule.tolerance} mm · rule set v${rule.version}`;
      const panels = buildPanels(luff, foot, cloth.usable - rule.seam);
      const cutStatus = plan.num <= 130;
      for (const panel of panels) {
        panelRows.push([plan.code, panel.number, JSON.stringify(panel.outline), panel.length_mm, panel.width_mm, panel.area_mm2, cutStatus]);
      }
      if (cutStatus) {
        const stockCode = plan.sail === "mainsail" ? "R-03" : "R-02";
        const stock = ROLLS.find((roll) => roll.code === stockCode)!;
        const laid: { number: number; x: number; y: number; rotation: 0 | 180; outline: Outline }[] = [];
        for (const panel of panels) {
          const fit = autoPosition(panel, 50000, stock.usable, laid.map((lay) => lay.outline))!;
          laid.push({ number: panel.number, x: fit.x_mm, y: fit.y_mm, rotation: fit.rotation, outline: placeOutline(panel, fit.x_mm, fit.y_mm, fit.rotation) });
        }
        const usedMm = Math.max(...laid.map((lay) => outlineExtent(lay.outline).maxX));
        const claimId = `CL-S${String(++claimNumber).padStart(5, "0")}`;
        claimRows.push([claimId, stockCode, plan.code, "A-01", usedMm, "cut", at("2026-03-01T08:00:00Z"), at("2026-03-01T08:20:00Z"), usedMm]);
        for (const lay of laid) {
          layRows.push([claimId, lay.number, plan.code, lay.x, lay.y, lay.rotation, JSON.stringify(lay.outline), outlineExtent(lay.outline).maxX]);
        }
        if (plan.num <= 70) {
          const input: SheetInput = {
            code: plan.code,
            boatName: plan.boat.name,
            sail: plan.sail,
            ownerName: plan.boat.ownerName,
            cloth: { code: cloth.code, name: cloth.name, usableWidthMm: cloth.usable },
            dimensions: used.map((key) => ({ key, mm: plan.boat.dims[key] })),
            areaMm2,
            roachPermille: rule.roach,
            rule: { version: rule.version, toleranceMm: rule.tolerance, seamOverlapMm: rule.seam },
            panels: panels.map((panel) => ({ number: panel.number, outline: panel.outline, lengthMm: panel.length_mm, widthMm: panel.width_mm, areaMm2: panel.area_mm2 })),
            nests: [{ stockCode, usedMm, widthMm: stock.width, usableWidthMm: stock.usable, lot: stock.lot, lays: laid.map((lay) => ({ outline: lay.outline })) }],
            predecessor: null,
          };
          const bytes = renderSheet(input);
          const sha = sha256Hex(bytes);
          sheet = { sha, size: bytes.length, key: sheetKey(plan.code, sha) };
          sheets.push({ code: plan.code, bytes, key: sheet.key, sha });
        }
      }
    }
    drawingRows.push([
      plan.code, plan.num, plan.boat.code, plan.sail, plan.cloth, plan.phase, rule?.version ?? null, plan.assignedTo,
      isDrawn ? luff : null, isDrawn ? foot : null, areaMm2, basis,
      isDrawn ? plan.boat.name : null, isDrawn ? plan.boat.ownerName : null,
      isDrawn ? JSON.stringify({ [used[0]]: luff, [used[1]]: foot }) : null,
      sheet?.sha ?? null, sheet?.size ?? null, sheet?.key ?? null,
    ]);
  }

  // ---- the store: every sheet is written and read back; those the store confirmed are Issued at once
  const confirmed = new Set<string>();
  if (storeReachable) {
    const queue = [...sheets];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        for (let sheet = queue.shift(); sheet; sheet = queue.shift()) {
          try {
            await putObject(sheet.key, sheet.bytes, "image/svg+xml");
            if (await storeConfirms(sheet.key, sheet.bytes)) confirmed.add(sheet.code);
          } catch (error) {
            if (!(error instanceof StoreUnavailable)) throw error;
          }
        }
      }),
    );
  }
  for (const row of drawingRows) {
    const code = row[0] as string;
    const num = row[1] as number;
    if (num <= 60) row[5] = confirmed.has(code) ? "issued" : "pending_store";
    else if (num <= 70) row[5] = "pending_store";
  }

  await db.query("BEGIN");
  try {
    await seedRecords(db, plans, drawingRows, panelRows, claimRows, layRows);
    await run(db, "INSERT INTO meta (key, value) VALUES ('seeded', 'yes')");
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function seedRecords(db: Queryable, plans: DrawingPlan[], drawingRows: unknown[][], panelRows: unknown[][], claimRows: unknown[][], layRows: unknown[][]): Promise<void> {
  await bulk(db, "code_seq", ["name", "next"], [
    ["boat", 13], ["drawing", 241], ["roll", 17], ["offcut", 9], ["submission", 123], ["grant", 61], ["account", 10], ["ruleset", 5],
  ]);
  await bulk(db, "account", ["id", "num", "email", "display_name", "role", "seeded"], ACCOUNTS.map((a) => [a.id, a.num, a.email, a.name, a.role, true]));
  await bulk(db, "closure", ["day"], CLOSURES.map((day) => [day]));
  await bulk(db, "ruleset", ["version", "effective_at", "seam_overlap_mm", "roach_permille", "tolerance_mm", "min_offcut_width_mm", "min_offcut_length_mm"],
    RULE_SETS.map((r) => [r.version, r.effectiveAt, r.seam, r.roach, r.tolerance, r.minWidth, r.minLength]));
  await bulk(db, "cloth", ["code", "name", "weight", "width_mm", "usable_width_mm", "rate_pence_per_m2"], CLOTHS.map((c) => [c.code, c.name, c.weight, c.width, c.usable, c.rate]));
  await bulk(db, "boat", ["code", "num", "name", "class_name", "owner_id"], SEED_BOATS.map((b) => [b.code, b.num, b.name, b.className, b.ownerId]));

  // measurements: the first tape reading of every dimension, the two later readings, and the accepted submissions
  const measurementRows: unknown[][] = [];
  const idOf = async () => `m-${String((await one<{ n: number }>(db, "SELECT nextval('opaque_seq') AS n"))!.n).padStart(9, "0")}`;
  for (const boat of SEED_BOATS) {
    for (const key of ["I", "J", "P", "E", "LL", "LP"] as const) {
      measurementRows.push([await idOf(), boat.code, key, boat.dims[key], "2026-01-15", "sailmaker", null, 20]);
    }
    if (boat.code === "B-11") measurementRows.push([await idOf(), "B-11", "P", 12345, "2026-10-29", "sailmaker", null, 20]);
    if (boat.code === "B-12") measurementRows.push([await idOf(), "B-12", "P", 10080, "2026-10-30", "sailmaker", null, 20]);
  }

  // submissions
  const submissionRows: unknown[][] = [];
  let submissionNumber = 0;
  const currentOf = (boat: SeedBoat, key: DimensionKey): number => {
    if (boat.code === "B-11" && key === "P") return 12345;
    if (boat.code === "B-12" && key === "P") return 10080;
    return boat.dims[key];
  };
  for (const [ownerIndex, sequence] of SUBMISSION_SEQUENCES.entries()) {
    const owner = ACCOUNTS.filter((a) => a.role === "yacht-owner")[ownerIndex]!;
    const boat = SEED_BOATS.find((b) => b.ownerId === owner.id)!;
    const cycle: DimensionKey[] = owner.name === "Priya Marlow" ? ["I", "J", "E"] : ["I", "J", "P", "E"];
    for (const [k0, token] of [...sequence].entries()) {
      submissionNumber++;
      const submittedAt = new Date(at("2026-02-02T09:00:00Z").getTime() + k0 * 86_400_000 + ownerIndex * 3_600_000);
      const dimension = cycle[k0 % cycle.length]!;
      const value = currentOf(boat, dimension);
      const id = `S-${String(submissionNumber).padStart(4, "0")}`;
      const decided = token !== "P";
      const decidedAt = decided ? new Date(submittedAt.getTime() + 2 * 3_600_000) : null;
      const status = token === "A" ? "accepted" : token === "R" ? "rejected" : token === "V" ? "reversed" : "pending";
      const reason = token === "R" ? "Figure taken to the wrong mark" : token === "V" ? "Tape slipped on the black band" : null;
      let measurementId: string | null = null;
      if (token === "A") {
        measurementId = await idOf();
        measurementRows.push([measurementId, boat.code, dimension, value, submittedAt.toISOString().slice(0, 10), "submission", id, 20]);
      }
      submissionRows.push([id, submissionNumber, boat.code, dimension, value, `${value} mm`, submittedAt.toISOString().slice(0, 10), "", status, owner.id, submittedAt, decidedAt, decided ? ACTOR : null, reason, measurementId]);
    }
  }
  await bulk(db, "measurement", ["id", "boat_code", "dimension", "value_mm", "measured_on", "source", "submission_id", "tolerance_mm"], measurementRows);
  await bulk(db, "submission", ["id", "num", "boat_code", "dimension", "value_mm", "as_submitted", "measured_on", "note", "status", "submitted_by", "submitted_at", "decided_at", "decided_by", "reason", "measurement_id"], submissionRows);

  // stock and the ledger that explains it
  const stockRows: unknown[][] = [];
  const ledger: { stock: string; account: string; amount: number; counter: string; reason: string }[] = [];
  for (const roll of ROLLS) {
    stockRows.push([roll.code, roll.num, "roll", roll.cloth, roll.lot, roll.width, roll.usable, roll.remaining, roll.width * roll.remaining, roll.shelf]);
    ledger.push({ stock: roll.code, account: roll.code, amount: roll.width * 50000, counter: "supplier-receipt", reason: "Received, full roll" });
  }
  for (const offcut of OFFCUTS) {
    stockRows.push([offcut.code, offcut.num, "offcut", offcut.cloth, offcut.lot, offcut.width, offcut.usable, offcut.length, offcut.width * offcut.length, "Offcut bin"]);
    ledger.push({ stock: offcut.code, account: offcut.code, amount: offcut.width * offcut.length, counter: "opening-stock", reason: "Opening count" });
  }
  for (let j = 0; j < 576; j++) {
    const roll = ROLLS[j % 16]!;
    const perCut = (50000 - roll.remaining) / 36;
    ledger.push({ stock: roll.code, account: roll.code, amount: -(roll.width * perCut), counter: "imported-history", reason: "Imported from spreadsheet" });
  }
  await bulk(db, "stock", ["code", "num", "kind", "cloth_code", "lot", "width_mm", "usable_width_mm", "remaining_mm", "on_hand_mm2", "shelf_location"], stockRows);
  const ledgerRows: unknown[][] = [];
  ledger.forEach((pair, index) => {
    const p = index + 1;
    const postedAt = new Date(at("2026-03-02T08:00:00Z").getTime() + index * FOUR_HOURS);
    const pairId = `PS-${String(p).padStart(4, "0")}`;
    ledgerRows.push([2 * p - 1, pairId, postedAt, pair.account, pair.amount, pair.stock, "", ACTOR, pair.reason]);
    ledgerRows.push([2 * p, pairId, postedAt, pair.counter, -pair.amount, pair.stock, "", ACTOR, pair.reason]);
  });
  await bulk(db, "ledger_line", ["line_id", "pair_id", "posted_at", "account", "amount_mm2", "stock_code", "drawing_code", "actor_email", "reason"], ledgerRows);

  await bulk(db, "drawing", ["code", "num", "boat_code", "sail", "cloth_code", "phase", "ruleset_version", "assigned_to", "luff_mm", "foot_mm", "area_mm2", "area_basis", "recorded_boat_name", "recorded_owner_name", "recorded_dims", "cut_sheet_sha", "cut_sheet_size", "cut_sheet_key"], drawingRows);
  await bulk(db, "panel", ["drawing_code", "number", "outline", "length_mm", "width_mm", "area_mm2", "cut"], panelRows);
  await bulk(db, "claim", ["id", "stock_code", "drawing_code", "holder_id", "length_mm", "status", "taken_at", "expires_at", "used_mm"], claimRows);
  await bulk(db, "lay", ["claim_id", "panel_number", "drawing_code", "x_mm", "y_mm", "rotation", "outline", "max_x"], layRows);

  await bulk(db, "authority", ["id", "loft_hand_id", "valid_from", "valid_until"], [
    ["AT-S0001", "A-02", at("2026-01-01T00:00:00Z"), null],
    ["AT-S0002", "A-03", at("2026-01-01T00:00:00Z"), at("2026-06-30T00:00:00Z")],
  ]);
  const grantRows: unknown[][] = [];
  for (const plan of plans.filter((p) => p.num <= 60)) {
    grantRows.push([`G-${String(plan.num).padStart(4, "0")}`, plan.num, plan.code, plan.boat.ownerId, at("2026-07-01T09:00:00Z"), null, plan.num === 10 ? at("2026-08-01T09:00:00Z") : null]);
  }
  await bulk(db, "sight_grant", ["id", "num", "drawing_code", "owner_id", "granted_at", "ends_at", "withdrawn_at"], grantRows);
}
