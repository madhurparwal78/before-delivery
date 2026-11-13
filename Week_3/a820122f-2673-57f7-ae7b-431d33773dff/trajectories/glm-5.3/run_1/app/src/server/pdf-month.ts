import { CrewRecord, type CrewDayView } from "./crew-record.js";
import { query } from "./db.js";
import { buildPdf, paginate, type PdfLine } from "./pdf.js";

/**
 * The sealed record PDF: it names the crew member, vessel and month, and lists
 * each ship's date with its rest hours, every recorded breach, every note,
 * every Late entry and both signature times.
 */
export async function buildMonthDocument(
  record: CrewRecord,
  month: string,
  days: CrewDayView[]
): Promise<Buffer> {
  const crew = await recordCrewOf(record.crewId);
  const breaches = await query<{ rule: string; window_start_utc: string; window_end_utc: string; still: boolean }>(
    `SELECT rule, window_start_utc, window_end_utc, false AS still FROM breaches WHERE crew_id = $1 ORDER BY window_start_utc`,
    [record.crewId]);
  const lines: PdfLine[] = [
    { text: "Sixbell Rest Log", bold: true },
    { text: `Sealed record for ${crew?.name ?? ""} (${crew?.rank ?? ""}), ${crew?.vesselName ?? ""}` },
    { text: `Month ${month}` },
    { text: "" },
  ];
  for (const day of days) {
    lines.push({ text: `Ship's day ${day.ship_date}: ${day.rest_hours.toFixed(1)} hours of rest, ${day.state}.`, bold: true });
    if (day.signed_at_utc) lines.push({ text: `  Signed at ${day.signed_at_utc}` });
    if (day.countersigned_at_utc) lines.push({ text: `  Countersigned at ${day.countersigned_at_utc}` });
    for (const note of day.notes) lines.push({ text: `  Note by ${note.author_role} at ${note.created_at_utc}: ${note.text}` });
    for (const entry of day.entries.filter((e) => e.late)) {
      lines.push({ text: `  Late entry: ${entry.start_utc} to ${entry.end_utc} (${entry.kind})` });
    }
    for (const event of day.events) {
      lines.push({ text: event.mismatch ? `  Record mismatch: ${event.description}` : `  Event: ${event.description}` });
    }
  }
  if (breaches.length > 0) {
    lines.push({ text: "" });
    lines.push({ text: "Recorded breaches", bold: true });
    for (const breach of breaches) {
      lines.push({ text: `${breach.rule} ${breach.window_start_utc} to ${breach.window_end_utc}` });
    }
  }
  return buildPdf(paginate(lines).pages);
}

async function recordCrewOf(crewId: string): Promise<{ name: string; rank: string; vesselName: string } | null> {
  const rows = await query<{ name: string; rank: string; vessel_name: string }>(
    `SELECT c.name, c.rank, v.name AS vessel_name FROM crew c JOIN vessels v ON v.id = c.vessel_id WHERE c.id = $1`, [crewId]);
  const row = rows[0];
  return row ? { name: row.name, rank: row.rank, vesselName: row.vessel_name } : null;
}
