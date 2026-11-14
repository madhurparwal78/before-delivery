import { timers } from "./config.ts";
import { pool, query } from "./db.ts";
import { simClock } from "./domain/clock.ts";
import { debrief } from "./domain/scoring.ts";
import { RULES, type RuleId } from "./domain/rules.ts";
import type { LogEntry } from "./domain/state.ts";
import { notFound, running, storageUnavailable } from "./errors.ts";
import { file, route } from "./http.ts";
import { MailError, sendMail } from "./mail.ts";
import { getObject, putObject, StorageError } from "./s3.ts";
import { logOf } from "./exercise.ts";
import { accessOutcome, seatRows, type SessionRow } from "./sessions.ts";
import { csvText } from "./csv.ts";
import { pdfDocument } from "./pdf.ts";

type Kind = "csv" | "pdf";

const CONTENT_TYPE: Record<Kind, string> = { csv: "text/csv; charset=utf-8", pdf: "application/pdf" };

function csvReport(row: SessionRow, log: LogEntry[], score: number): Buffer {
  const lines: unknown[][] = [["sim_time", "position", "kind", "callsign", "rule", "penalty", "text"]];
  for (const entry of log) {
    const rule = entry.kind === "alert" ? (entry.rule ?? "") : "";
    lines.push([
      simClock(entry.simTime),
      entry.position,
      entry.kind,
      entry.callsign ?? "",
      rule,
      rule === "" ? "" : RULES[rule as RuleId].penalty,
      entry.text,
    ]);
  }
  lines.push([simClock(row.state.simTime), "INS", "score", "", "", "", `Score ${score} of 100`]);
  return Buffer.from(csvText(lines), "utf8");
}

async function pdfReport(row: SessionRow, log: LogEntry[], result: ReturnType<typeof debrief>): Promise<Buffer> {
  const seats = await seatRows(pool, row.id);
  const student = (position: "GND" | "TWR"): string => `${seats.find((s) => s.position === position)?.name ?? "none"} (${position})`;
  const summary = [
    "Runup Bay debrief",
    `Scenario: ${row.setup.scenarioName}`,
    `Aerodrome: ${row.setup.aerodromeName}`,
    `Students: ${student("GND")}, ${student("TWR")}`,
    `Score: ${result.score} of 100`,
    `Result: ${result.passed ? "Passed" : "Not passed"}`,
    ...result.breakdown.map((b) => `${b.simTime} ${b.rule} ${b.text} -${b.penalty}`),
    `Total ${result.score}`,
  ];
  const timeline = log.map((entry) => `${simClock(entry.simTime)} ${entry.position} ${entry.kind} ${entry.text}`);
  return pdfDocument(summary, timeline);
}

export function registerReportRoutes(): void {
  route("GET", "/api/sessions/:id/report.:kind", async (ctx) => {
    const access = await accessOutcome(ctx, ctx.params[0] ?? "");
    const kind = ctx.params[1];
    if (kind !== "csv" && kind !== "pdf") throw notFound();
    const { row } = access;
    if (row.status !== "ended") throw running();
    const key = `reports/${row.id}/report.${kind}`;
    const headers = (notice: string): Record<string, string> => ({
      "Content-Type": CONTENT_TYPE[kind],
      "Content-Disposition": `attachment; filename="report.${kind}"`,
      "X-Report-Notice": notice,
    });
    try {
      const stored = await query(pool, "SELECT 1 FROM reports WHERE session_id = $1 AND kind = $2", [row.id, kind]);
      if (stored.length > 0) return file(await getObject(key), headers("repeat"));
      const log = await logOf(row.id);
      const result = debrief(row.setup, row.state, timers, log);
      const bytes = kind === "csv" ? csvReport(row, log, result.score) : await pdfReport(row, log, result);
      await putObject(key, bytes, CONTENT_TYPE[kind]);
      const claimed = await query(
        pool,
        "INSERT INTO reports (session_id, kind, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING session_id",
        [row.id, kind, access.user.id],
      );
      if (claimed.length === 0) return file(bytes, headers("repeat"));
      let notice = "sent";
      try {
        await sendMail(access.user.email, `Report ready: ${row.setup.scenarioName}`, `Your ${kind.toUpperCase()} report for ${row.setup.scenarioName} is saved.\n`);
      } catch (error) {
        if (!(error instanceof MailError)) throw error;
        notice = "not-sent";
      }
      return file(bytes, headers(notice));
    } catch (error) {
      if (error instanceof StorageError) throw storageUnavailable("reports");
      throw error;
    }
  });
}
