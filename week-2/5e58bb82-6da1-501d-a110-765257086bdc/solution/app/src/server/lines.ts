// Line records: mainscheme lines, crosslines, infill lines and re-runs, in the lines-endpoint order.
import type { Db } from "./db.js";
import { rows } from "./db.js";
import type { Position } from "./geometry.js";
import { newId } from "./passwords.js";
import type { LineKind, LineRecord, LineView } from "./records.js";

const GROUP: Record<LineKind, string> = { planned: "0", crossline: "1", infill: "2" };

/** Sort key: kind group, label number, then the re-run chain, so each re-run follows its original. */
export function sortKey(kind: LineKind, labelNumber: number, rerunSuffix = ""): string {
  return `${GROUP[kind]}-${String(labelNumber).padStart(5, "0")}${rerunSuffix}`;
}

interface NewLine {
  label: string;
  kind: "planned" | "crossline";
  start: Position;
  end: Position;
  length_m: number;
  offset_m: number | null;
}

export async function insertLines(db: Db, missionId: string, lines: NewLine[], idStem?: string): Promise<void> {
  for (const line of lines) {
    const id = idStem ? `l-${idStem}-${line.label.toLowerCase()}` : newId("l");
    await db.query(
      `INSERT INTO lines (id, mission_id, label, kind, sort_key, status, start_e, start_n, end_e, end_n, length_m, offset_m)
       VALUES ($1,$2,$3,$4,$5,'Pending',$6,$7,$8,$9,$10,$11)`,
      [id, missionId, line.label, line.kind, sortKey(line.kind, Number(line.label.slice(1))), line.start.easting,
        line.start.northing, line.end.easting, line.end.northing, line.length_m, line.offset_m]);
  }
}

/** Lines of a mission with their covered length, in lines-endpoint order. */
export async function loadLines(db: Db, missionId: string, lock = false): Promise<LineView[]> {
  return rows<LineView>(db,
    `SELECT l.*, v.name AS vessel_name,
       COALESCE((SELECT sum(s.length_m) FROM sweeps s WHERE s.line_id = l.id), 0) AS covered_m
     FROM lines l LEFT JOIN vessels v ON v.id = l.vessel_id
     WHERE l.mission_id = $1 ORDER BY l.sort_key${lock ? " FOR UPDATE OF l" : ""}`, [missionId]);
}

/** One line of a mission, read the same way, for a line the caller holds on that mission. */
export async function loadLine(db: Db, missionId: string, lineId: string): Promise<LineView> {
  const [line] = (await loadLines(db, missionId)).filter((l) => l.id === lineId);
  return line;
}

export function lineJson(l: LineView): Record<string, unknown> {
  const finished = ["Surveyed", "Delivered", "Superseded"].includes(l.status) && l.file_state;
  return {
    id: l.id,
    mission_id: l.mission_id,
    label: l.label,
    kind: l.kind,
    status: l.status,
    rerun_of: l.rerun_of ?? null,
    vessel_id: l.vessel_id ?? null,
    vessel_name: l.vessel_name ?? null,
    start: { easting: l.start_e, northing: l.start_n },
    end: { easting: l.end_e, northing: l.end_n },
    length_m: l.length_m,
    covered_m: Number(l.covered_m ?? 0),
    holiday_id: l.holiday_id ?? null,
    file: finished
      ? l.file_state === "Stored"
        ? { state: "Stored", name: l.file_name, size_bytes: Number(l.file_size), sha256: l.file_sha256, stored_at: l.file_stored_at.toISOString() }
        : { state: "Awaiting upload", name: null, size_bytes: null, sha256: null, stored_at: null }
      : null,
  };
}

export const finished = (status: string) => status === "Surveyed" || status === "Delivered" || status === "Superseded";

/**
 * Which lines count in overlap, strips, holidays and agreement: an original until its re-run is Delivered,
 * a re-run only once it is Delivered.
 */
export function counts(l: LineRecord): boolean {
  return l.status !== "Superseded" && (l.rerun_of === null || l.status === "Delivered");
}
