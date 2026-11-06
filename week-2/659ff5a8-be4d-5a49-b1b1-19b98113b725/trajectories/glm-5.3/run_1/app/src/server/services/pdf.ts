// HTML for the waiver and results PDFs, rendered by Gotenberg.
import type { EventRow, RegistrationRow } from "../domain/types.js";

export function waiverHtml(clubName: string, event: EventRow, reg: RegistrationRow, signature: string, at: Date): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, Helvetica, sans-serif; margin: 40px; color: #111; }
h1 { font-size: 20px; }
.line { margin: 8px 0; }
.sign { margin-top: 40px; font-weight: bold; }
</style></head><body>
<h1>Event waiver</h1>
<div class="line">Club: ${esc(clubName)}</div>
<div class="line">Event: ${esc(event.name)}</div>
<div class="line">Date: ${esc(event.date)}</div>
<div class="line">Driver: ${esc(reg.driver_name)}</div>
<div class="line">Car number: ${esc(String(reg.car_number))}</div>
<div class="line">Class: ${esc(reg.class_code)}</div>
<p>I acknowledge the risks of motorsport, agree to follow all event rules and official
instructions, and release the club, its officers and venue owners from any liability for
injury or damage arising from my participation in this event.</p>
<div class="sign">Signed by ${esc(signature)} at ${at.toISOString()}</div>
</body></html>`;
}

export function resultsHtml(
  clubName: string,
  event: EventRow,
  sections: { title: "Raw" | "Class" | "Indexed"; rows: ResultsLine[] }[],
): string {
  const sectionHtml = sections
    .map((section) => {
      const rowsHtml = section.rows
        .map(
          (r) =>
            `<tr><td>${esc(r.position)}</td><td>${esc(String(r.carNumber))}</td><td>${esc(r.classCode)}</td><td>${esc(r.driverName)}</td><td class="num">${esc(r.time)}</td><td>${esc(r.extra ?? "")}</td></tr>`,
        )
        .join("");
      return `<div class="section"><h1>${esc(event.name)} final results</h1>
      <h2>${clubName} - ${esc(section.title)}</h2>
      <table><thead><tr><th>Pos</th><th>Car</th><th>Class</th><th>Driver</th><th>Best time</th><th>Factor</th></tr></thead>
      <tbody>${rowsHtml}</tbody></table></div>`;
    })
    .join('<div style="page-break-after: always"></div>');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
body { font-family: Arial, Helvetica, sans-serif; margin: 30px; color: #111; }
h1 { font-size: 16px; }
h2 { font-size: 13px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; }
th, td { border: 1px solid #999; padding: 3px 6px; text-align: left; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.section { page-break-after: always; }
</style></head><body>${sectionHtml}</body></html>`;
}

export interface ResultsLine {
  position: string;
  carNumber: number;
  classCode: string;
  driverName: string;
  time: string;
  extra?: string;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
