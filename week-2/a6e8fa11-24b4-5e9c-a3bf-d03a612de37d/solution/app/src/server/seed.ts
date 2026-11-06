// Seed data (brief · Seed data). Seed ops are authored by each station's data manager; each seeded
// workbook's headSeq is its seed op count.
import { randomUUID } from "node:crypto";
import { type WorkbookContent } from "../shared/engine.js";
import { type Op } from "../shared/ops.js";
import { type CellFormat } from "../shared/values.js";
import { parseLocalDateTime, resolveLocal } from "../shared/time.js";
import { hashPassword } from "./auth.js";
import { type Tx } from "./db.js";
import { type Role } from "./rules/roles.js";
import { type SeasonState } from "./rules/season.js";
import { appendOps } from "./sync.js";

const PASSWORD = "tally-field-2026";

const STATIONS = [
  { key: "ridgeback", name: "Ridgeback Research Station", timeZone: "America/Chicago" },
  { key: "coldwater", name: "Coldwater Extension Farm", timeZone: "America/Denver" },
] as const;

const MEMBERS: Array<{ name: string; email: string; station: "ridgeback" | "coldwater"; role: Role }> = [
  { name: "Priya Raman", email: "priya@ridgeback.example", station: "ridgeback", role: "data_manager" },
  { name: "Tomás Herrera", email: "tomas@ridgeback.example", station: "ridgeback", role: "lead" },
  { name: "Dana Okafor", email: "dana@ridgeback.example", station: "ridgeback", role: "technician" },
  { name: "Lee Vance", email: "lee@ridgeback.example", station: "ridgeback", role: "technician" },
  { name: "Sam Ito", email: "sam@ridgeback.example", station: "ridgeback", role: "viewer" },
  { name: "Wren Castillo", email: "wren@coldwater.example", station: "coldwater", role: "data_manager" },
  { name: "Noor Haddad", email: "noor@coldwater.example", station: "coldwater", role: "lead" },
  { name: "Jo Mbeki", email: "jo@coldwater.example", station: "coldwater", role: "technician" },
];

const PLOTS: Array<[number, string, string, string, string, string]> = [
  [2, "101", "1", "RB-21", "14.2", "58.4"],
  [3, "102", "1", "RB-34", "13.8", "61.0"],
  [4, "103", "1", "Check AG-30", "14.6", "55.2"],
  [5, "201", "2", "RB-34", "13.5", "60.2"],
  [6, "202", "2", "Check AG-30", "14.9", "54.1"],
  [7, "203", "2", "RB-21", "14.0", "57.6"],
  [8, "301", "3", "Check AG-30", "14.4", "56.0"],
  [9, "302", "3", "RB-21", "13.9", "59.1"],
  [10, "303", "3", "RB-34", "13.6", "62.3"],
  [11, "401", "4", "RB-21", "14.3", "58.0"],
  [12, "402", "4", "RB-34", "13.7", "60.8"],
  [13, "403", "4", "Check AG-30", "14.8", "54.7"],
];

class OpList {
  readonly ops: Op[] = [];

  cell(sheetId: string, cell: string, input: string): void {
    this.ops.push({ opId: randomUUID(), type: "setCell", sheetId, cell, input });
  }

  row(sheetId: string, row: number, inputs: string[]): void {
    inputs.forEach((input, i) => this.cell(sheetId, `${String.fromCharCode(65 + i)}${row}`, input));
  }

  format(sheetId: string, range: string, format: Partial<CellFormat>): void {
    this.ops.push({ opId: randomUUID(), type: "setFormat", sheetId, range, format });
  }
}

function soybean(plots: string, analysis: string): Op[] {
  const list = new OpList();
  list.row(plots, 1, ["Plot", "Rep", "Entry", "Planted", "Moisture %", "Yield bu/ac", "Adj. yield 13%", "DAP"]);
  for (const [r, plot, rep, entry, moisture, yieldText] of PLOTS) {
    list.row(plots, r, [plot, rep, entry, "2026-05-12", moisture, yieldText, `=F${r}*(100-E${r})/87`, `=TODAY()-D${r}`]);
  }
  const lastRow = PLOTS[PLOTS.length - 1][0];
  list.format(plots, "A1:H1", { bold: true });
  list.format(plots, `E2:G${lastRow}`, { numberFormat: "0.0" });
  list.format(plots, `H2:H${lastRow}`, { numberFormat: "0" });
  list.ops.push({ opId: randomUUID(), type: "addSheet", sheetId: analysis, name: "Analysis" });
  list.row(analysis, 1, ["Entry", "Mean adj. yield", "Delta vs check"]);
  ["RB-21", "RB-34", "Check AG-30"].forEach((entry, i) => {
    const r = i + 2;
    list.row(analysis, r, [entry, `=AVERAGEIF(Plots!$C$2:$C$13,A${r},Plots!$G$2:$G$13)`, `=B${r}-$B$4`]);
  });
  list.format(analysis, "A1:C1", { bold: true });
  list.format(analysis, "B2:C4", { numberFormat: "0.00" });
  list.ops.push({ opId: randomUUID(), type: "addChart", chartId: randomUUID(), sheetId: analysis, chartType: "bar", title: "Mean adjusted yield by entry", range: "Analysis!A1:B4" });
  return list.ops;
}

function nitrogen(plots: string): Op[] {
  const list = new OpList();
  list.row(plots, 1, ["Plot", "N rate lb/ac", "Yield bu/ac"]);
  list.row(plots, 2, ["101", "0", "142.3"]);
  list.row(plots, 3, ["102", "60", "171.8"]);
  list.row(plots, 4, ["103", "120", "186.4"]);
  return list.ops;
}

function wheat(plots: string): Op[] {
  const list = new OpList();
  list.row(plots, 1, ["Plot", "Entry", "Heading date"]);
  list.row(plots, 2, ["11", "CW-Glen", "2026-07-02"]);
  return list.ops;
}

async function seedWorkbook(
  t: Tx,
  station: { id: string; timeZone: string },
  author: { id: string; name: string },
  book: { name: string; state: SeasonState; cutoff: string | null; build: (plots: string, extra: string) => Op[] },
): Promise<void> {
  const id = randomUUID();
  const plots = randomUUID();
  const ops = book.build(plots, randomUUID());
  const genesis: WorkbookContent = { sheets: [{ id: plots, name: "Plots", cells: {} }], charts: [] };
  const local = book.cutoff ? parseLocalDateTime(book.cutoff) : null;
  const resolved = local ? resolveLocal(local, station.timeZone) : null;
  const sheets = 1 + ops.filter((o) => o.type === "addSheet").length;
  await t.query(
    `INSERT INTO workbooks (id, station_id, name, state, closes_at_local, closes_at_utc, genesis, head_seq, sheet_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, station.id, book.name, book.state, book.cutoff, resolved?.kind === "instant" ? new Date(resolved.ms) : null, JSON.stringify(genesis), ops.length, sheets],
  );
  await appendOps(t, id, ops.map((op, i) => ({ seq: i + 1, op })), author);
}

/** Inserts the seed once; later serves find it and change nothing. */
export async function seed(t: Tx): Promise<void> {
  const existing = await t.query("SELECT 1 FROM stations LIMIT 1");
  if (existing.rowCount) return;
  const stationIds = new Map<string, { id: string; timeZone: string }>();
  for (const s of STATIONS) {
    const id = randomUUID();
    stationIds.set(s.key, { id, timeZone: s.timeZone });
    await t.query("INSERT INTO stations (id, name, time_zone) VALUES ($1, $2, $3)", [id, s.name, s.timeZone]);
  }
  const managers = new Map<string, { id: string; name: string }>();
  for (const m of MEMBERS) {
    const id = randomUUID();
    const station = stationIds.get(m.station) as { id: string };
    await t.query("INSERT INTO members (id, station_id, name, email, role, status, password_hash) VALUES ($1, $2, $3, $4, $5, 'active', $6)", [
      id,
      station.id,
      m.name,
      m.email,
      m.role,
      await hashPassword(PASSWORD),
    ]);
    if (m.role === "data_manager") managers.set(m.station, { id, name: m.name });
  }
  const ridgeback = stationIds.get("ridgeback") as { id: string; timeZone: string };
  const coldwater = stationIds.get("coldwater") as { id: string; timeZone: string };
  const priya = managers.get("ridgeback") as { id: string; name: string };
  const wren = managers.get("coldwater") as { id: string; name: string };
  await seedWorkbook(t, ridgeback, priya, { name: "2026 Soybean Variety Trial RB-SOY-26", state: "in_season", cutoff: null, build: soybean });
  await seedWorkbook(t, ridgeback, priya, { name: "2025 Nitrogen Rate Trial RB-N-25", state: "locked", cutoff: "2025-10-20T17:00:00", build: nitrogen });
  await seedWorkbook(t, coldwater, wren, { name: "2026 Spring Wheat Trial CW-WHT-26", state: "in_season", cutoff: null, build: wheat });
}
