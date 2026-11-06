// The coverage report: canonical bytes written once, then one report-ready email per reviewer.
import { createHash } from "node:crypto";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { one, only, pool, rows, tx } from "./db.js";
import { agreement, counters } from "./coverage.js";
import { objectKey, reportKey } from "./files.js";
import { loadLines } from "./lines.js";
import { queueMail } from "./mail.js";
import { roundHalf } from "./numbers.js";
import type { ClientOrgRecord, HolidayRecord, MissionRecord, UserRecord } from "./records.js";
import { putObject } from "./s3.js";

/** The instant in an IANA zone as `YYYY-MM-DDTHH:MM:SS±HH:MM`. */
function localIso(instant: Date, zone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const minutes = Math.round((local - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
  const sign = minutes < 0 ? "-" : "+";
  const offset = `${sign}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, "0")}:${String(Math.abs(minutes) % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** A completed mission whose report is still to be written. */
type PendingReport = MissionRecord & { report_state: "Pending" };

/** Report bytes from the stored record only, so a retried write produces identical bytes. */
async function reportBytes(db: Db, m: PendingReport): Promise<Buffer> {
  const org = await only<Pick<ClientOrgRecord, "name" | "time_zone">>(db, "SELECT name, time_zone FROM client_orgs WHERE id = $1", [m.client_org_id]);
  const lines = await loadLines(db, m.id);
  const generated = new Date(Math.floor(m.completed_at.getTime() / 1000) * 1000);
  const c = await counters(db, m.id);
  const totals = new Map<string, { lines: number; length: number; covered: number }>();
  for (const l of lines) {
    if ((l.status !== "Surveyed" && l.status !== "Delivered") || !l.vessel_name) continue;
    const t = totals.get(l.vessel_name) ?? { lines: 0, length: 0, covered: 0 };
    t.lines += 1;
    t.length += l.length_m;
    t.covered += Number(l.covered_m);
    totals.set(l.vessel_name, t);
  }
  const holidays = await rows<Pick<HolidayRecord, "label_no" | "cells">>(db, "SELECT label_no, cells FROM holidays WHERE mission_id = $1 AND status IN ('Open','Queued') ORDER BY label_no", [m.id]);
  const report = {
    mission_id: m.id,
    mission_name: m.name,
    client_name: org.name,
    completed_at: m.completed_at.toISOString(),
    generated_at: generated.toISOString().replace(/\.\d{3}Z$/, "Z"),
    generated_at_local: localIso(generated, org.time_zone),
    coverage_pct: c.coverage_pct,
    open_holidays: c.open_holidays,
    crossline_count: m.crossline_count,
    crossline_agreement: await agreement(db, m.id),
    delivered_lines: lines
      .flatMap((l) => (l.file_state === "Stored" && (l.status === "Delivered" || l.status === "Superseded")
        ? [{ label: l.label, kind: l.kind, file_name: l.file_name, size_bytes: Number(l.file_size), sha256: l.file_sha256, key: objectKey(l, l.file_name) }]
        : [])),
    vessel_totals: [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([vessel, t]) => ({ vessel, lines: t.lines, length_m: roundHalf(t.length, 1), covered_m: roundHalf(t.covered, 1) })),
    holidays: holidays.map((h) => ({ label: `H${h.label_no}`, area_m2: h.cells.length * 25, cell_count: h.cells.length })),
  };
  return Buffer.from(JSON.stringify(report), "utf8");
}

function readyEmail(m: MissionRecord, bytes: Buffer, sha: string): string[] {
  const report = JSON.parse(bytes.toString("utf8"));
  const local: string = report.generated_at_local;
  const ag = report.crossline_agreement;
  return [
    `Coverage report ready for ${m.name}.`,
    `Completed ${local.slice(0, 10)} ${local.slice(11, 16)} (${local.slice(19)})`,
    `Completed UTC ${report.generated_at.slice(0, 10)} ${report.generated_at.slice(11, 16)}`,
    `Report SHA-256 ${sha}`,
    `Coverage ${JSON.stringify(report.coverage_pct)}% · Open holidays ${report.open_holidays} · Crossline agreement ${ag.compared ? `${JSON.stringify(ag.pct)}% of ${ag.compared}` : "—"}`,
    `Open the survey: ${config.publicUrl}/surveys/${m.id}`,
  ];
}

/** Writes each Pending report once; Ready and its emails commit together after storage confirms. */
async function writePending(): Promise<void> {
  const pending = await rows<{ id: string }>(pool, "SELECT id FROM missions WHERE report_state = 'Pending' ORDER BY completed_at");
  for (const { id } of pending) {
    await tx(async (db) => {
      const m = await one<PendingReport>(db, "SELECT * FROM missions WHERE id = $1 AND report_state = 'Pending' FOR UPDATE SKIP LOCKED", [id]);
      if (!m) return;
      const bytes = await reportBytes(db, m);
      const sha = createHash("sha256").update(bytes).digest("hex");
      await putObject(reportKey(m.id), bytes, sha, "application/json");
      await db.query("UPDATE missions SET report_state = 'Ready', report_sha256 = $2, report_stored_at = $3 WHERE id = $1", [m.id, sha, new Date()]);
      const reviewers = await rows<UserRecord>(db, "SELECT * FROM users WHERE role = 'client_reviewer' AND client_org_id = $1 ORDER BY id", [m.client_org_id]);
      for (const r of reviewers) {
        await queueMail(db, "report", m.id, `report:${m.id}:${r.id}`, r, `Coverage report ready — ${m.name}`, readyEmail(m, bytes, sha));
      }
    }).catch(() => undefined);
  }
}

let running = false;

/** Runs now and every five seconds, so a write that failed while storage was down is retried. */
export function kickReports(): void {
  if (running) return;
  running = true;
  writePending().finally(() => {
    running = false;
  });
}

export function startReportWorker(): void {
  setInterval(kickReports, 5000);
}
