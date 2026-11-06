import { WAIVER_PARAGRAPHS } from "../../shared/copy.js";

const escapes: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value: string | number): string => String(value).replace(/[&<>"']/g, (c) => escapes[c] ?? c);

const STYLE = `
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #111; font-size: 12pt; }
  h1 { font-size: 24pt; margin: 0 0 4pt; }
  h2 { font-size: 16pt; margin: 18pt 0 8pt; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4pt 6pt; border-bottom: 0.5pt solid #999; }
  th.num, td.num { text-align: right; font-family: "Courier New", monospace; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .banner { font-weight: bold; font-size: 11pt; padding: 0 0 6pt; border-bottom: 1pt solid #111; }
  .section { break-before: page; }
  .signed { margin-top: 24pt; font-weight: bold; }
`;

const page = (body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`;

export interface WaiverDetails {
  clubName: string;
  eventName: string;
  eventDate: string;
  driverName: string;
  carNumber: number;
  classCode: string;
  signature: string;
  signedAt: string;
}

export function waiverHtml(d: WaiverDetails): string {
  return page(`
    <h1>Event waiver</h1>
    <p>${esc(d.clubName)}</p>
    <h2>${esc(d.eventName)} (${esc(d.eventDate)})</h2>
    <p>Driver: ${esc(d.driverName)}<br>Car ${esc(d.carNumber)} in class ${esc(d.classCode)}</p>
    ${WAIVER_PARAGRAPHS.map((p) => `<p>${esc(p)}</p>`).join("")}
    <p class="signed">Signed by ${esc(d.signature)} at ${esc(d.signedAt)}</p>`);
}

export interface ResultsLine {
  position: string;
  carNumber: number;
  classCode: string;
  driverName: string;
  time: string;
  factor: string;
}

interface ResultsDetails {
  eventName: string;
  raw: ResultsLine[];
  classes: ResultsLine[];
  indexed: ResultsLine[];
}

function section(title: string, header: string, lines: ResultsLine[], withFactor: boolean): string {
  const columns = withFactor ? 6 : 5;
  const body = lines
    .map(
      (l) => `<tr><td>${esc(l.position)}</td><td class="num">${esc(l.carNumber)}</td><td>${esc(l.classCode)}</td>
        <td>${esc(l.driverName)}</td><td class="num">${esc(l.time)}</td>${withFactor ? `<td class="num">${esc(l.factor)}</td>` : ""}</tr>`,
    )
    .join("");
  return `<div class="section"><h2>${esc(title)}</h2><table>
    <thead><tr><td colspan="${columns}" class="banner">${esc(header)}</td></tr>
    <tr><th>Position</th><th class="num">Car</th><th>Class</th><th>Driver</th><th class="num">${title === "Indexed" ? "Best indexed" : "Best adjusted"}</th>${withFactor ? '<th class="num">Factor</th>' : ""}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

export function resultsHtml(d: ResultsDetails): string {
  const header = `${d.eventName} final results`;
  return page(
    section("Raw", header, d.raw, false) + section("Class", header, d.classes, false) + section("Indexed", header, d.indexed, true),
  );
}
