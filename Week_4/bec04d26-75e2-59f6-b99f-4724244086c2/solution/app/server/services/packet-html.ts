import { readFileSync } from "node:fs";
import { dateWords } from "../../shared/calendar";
import { foldedReturnSvg, TILE_COLOURS } from "../../shared/tile";
import type { ReturnView } from "../../shared/types";
import { practiceMoment } from "../domain/labels";
import type { HtmlFile } from "./gotenberg";

const fontFile = (name: string): Buffer => readFileSync(new URL(`../../assets/fonts/${name}`, import.meta.url));

export const PACKET_FONTS: HtmlFile[] = [
  { name: "tilt-warp.woff2", data: fontFile("tilt-warp-latin-400-normal.woff2") },
  { name: "plus-jakarta-sans.woff2", data: fontFile("plus-jakarta-sans-latin-wght-normal.woff2") },
];

const escapeHtml = (text: string): string => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

const STYLE = `
@font-face { font-family: 'Tilt Warp'; src: url(tilt-warp.woff2) format('woff2'); font-weight: 400; }
@font-face { font-family: 'Plus Jakarta Sans'; src: url(plus-jakarta-sans.woff2) format('woff2'); font-weight: 200 800; }
@page { size: 8.5in 11in; margin: 0.7in; }
* { box-sizing: border-box; }
body { margin: 0; color: #000; background: #fff; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12pt; line-height: 1.5; }
.wordmark { font-family: 'Tilt Warp', sans-serif; font-weight: 400; font-size: 40pt; line-height: 1; margin: 0 0 20pt; }
h1 { font-size: 22pt; line-height: 1.2; margin: 0; font-weight: 800; }
.revision { color: #595959; margin: 2pt 0 22pt; font-weight: 600; }
.sheet { display: flex; gap: 30pt; align-items: flex-start; }
.tile { flex: none; width: 2.5in; height: 3.125in; border-radius: 14px; padding: 14pt; }
.tile svg { width: 100%; height: 100%; display: block; }
.facts { flex: 1; min-width: 0; }
.facts p { margin: 0 0 6pt; }
.client { font-size: 19pt; font-weight: 800; line-height: 1.25; }
.group { padding-top: 12pt; margin-top: 12pt; border-top: 2px solid #000; }
.due { font-weight: 800; font-size: 14pt; }
.money { font-weight: 800; font-size: 15pt; }
`;

/** The packet's text in groups, one fact per line, in the order the brief lists them. */
interface FactLine { text: string; style?: "due" | "money" }

function factGroups(r: ReturnView): FactLine[][] {
  const approval = [...r.approvals].reverse().find((a) => a.action === "approved");
  const groups: FactLine[][] = [
    [{ text: r.due_line, style: "due" },
      ...(r.carried_from ? [{ text: `Carried from ${dateWords(r.carried_from)}` }] : []),
      ...(r.extension ? [{ text: `Extended to ${dateWords(r.due_date)}` }] : [])],
    [{ text: `Rule edition effective ${r.edition.effective_date}` }, { text: `Due day ${r.edition.due_day}` },
      { text: `Reference rate ${r.edition.rate}%` }],
    [{ text: `Gross sales ${r.gross_sales}`, style: "money" }, { text: `Tax due ${r.tax_due}`, style: "money" }],
    [...(approval ? [{ text: `Approved by ${approval.by} on ${practiceMoment(Date.parse(approval.at))}` }] : []),
      ...r.amendments.map((a) => ({
        text: `Amended: gross sales ${a.original.gross_sales} to ${a.amended.gross_sales}, tax due ${a.original.tax_due} to ${a.amended.tax_due}`,
      }))],
  ];
  return groups.filter((group) => group.length);
}

export function packetHtml(r: ReturnView, revision: number): string {
  const groups = factGroups(r).map((group) => `<div class="group">${group.map((line) =>
    `<p${line.style ? ` class="${line.style}"` : ""}>${escapeHtml(line.text)}</p>`).join("\n")}</div>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Duefield filing packet</title><style>${STYLE}</style></head>
<body>
<p class="wordmark">Duefield</p>
<h1>Duefield filing packet</h1>
<p class="revision">Packet revision ${revision}</p>
<div class="sheet">
<div class="tile" style="background:${TILE_COLOURS[r.tone]}">${foldedReturnSvg(r.state, r.period_label, r.tone)}</div>
<div class="facts">
<p class="client">${escapeHtml(r.client.name)}</p>
<p>${escapeHtml(`${r.state_name} (${r.state})`)} · ${escapeHtml(r.period_label)}</p>
${groups}
</div>
</div>
</body></html>`;
}
