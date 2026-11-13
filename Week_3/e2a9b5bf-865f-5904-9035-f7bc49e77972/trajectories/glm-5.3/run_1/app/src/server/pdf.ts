// The packet HTML that Gotenberg turns into the PDF (DP-36, DP-97).
import type { PacketRow } from "#shared/api.js";
import { formatAperture, formatExitPupil } from "#shared/optics.js";
import { skyToScreen } from "#shared/projection.js";
import type { StrokeFile } from "#shared/strokes.js";
import { parseStrokeFileText } from "#shared/strokes.js";
import type { PacketRowRecord } from "./rows.js";

export interface PacketPageData {
  readonly row: PacketRow;
  readonly observation: Record<string, unknown>;
  readonly telescopeName: string;
  readonly apertureMm: number;
  readonly eyepieceName: string;
  readonly barlowName: string | null;
  readonly strokesText: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function withBreaks(value: string): string {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
}

export function buildPacketHtml(record: PacketRowRecord, pages: readonly PacketPageData[]): string {
  const cover = `
    <section class="page cover">
      <h1>Observing log packet ${record.number}</h1>
      <p class="program">${escapeHtml(programNameOf(record))}</p>
      <p>Observer: ${escapeHtml(displayNameOf(record))} (${escapeHtml(emailOf(record))})</p>
      <p>Objects: ${record.rows.length}</p>
      <p>Coordinator: ${escapeHtml(coordinatorNameOf(record))}</p>
    </section>`;
  const body = pages.map((page) => observationPage(page)).join("\n");
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @font-face { font-family: 'Sora'; src: url('/fonts/sora-400.woff2') format('woff2'); font-weight: 400; }
  @font-face { font-family: 'Sora'; src: url('/fonts/sora-600.woff2') format('woff2'); font-weight: 600; }
  @page { size: 612pt 792pt; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: 'Sora', sans-serif; font-size: 10.5pt; color: #10131a; }
  .page { width: 612pt; height: 792pt; padding: 44pt 48pt; page-break-after: always; overflow: hidden; position: relative; }
  .cover h1 { font-size: 26pt; font-weight: 600; margin-top: 130pt; margin-bottom: 26pt; }
  .cover .program { font-size: 16pt; margin-bottom: 40pt; color: #2a2f3a; }
  .cover p { font-size: 12.5pt; line-height: 1.9; }
  h2 { font-size: 16pt; font-weight: 600; margin-bottom: 12pt; }
  dl { line-height: 1.75; margin-bottom: 10pt; }
  dl div { display: flex; }
  dt { width: 120pt; flex: none; color: #2a2f3a; }
  dd { flex: 1; word-break: break-word; overflow-wrap: anywhere; }
  .sketch { display: flex; align-items: flex-start; gap: 18pt; margin-top: 8pt; }
  .circle { position: relative; width: 300pt; height: 300pt; border: 1.5pt solid #10131a; border-radius: 50%; flex: none; overflow: hidden; }
  .circle svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .compass { width: 96pt; text-align: left; line-height: 1.6; font-size: 10pt; color: #10131a; padding-top: 6pt; }
  .compass .arrow { font-size: 15pt; }
  .desc { margin-top: 8pt; overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
</style></head><body>${cover}${body}</body></html>`;
}

function programNameOf(record: PacketRowRecord): string {
  return String(record["program_name" as keyof PacketRowRecord] ?? "");
}

function displayNameOf(record: PacketRowRecord): string {
  return String(record["observer_name" as keyof PacketRowRecord] ?? "");
}

function emailOf(record: PacketRowRecord): string {
  return String(record["observer_email" as keyof PacketRowRecord] ?? "");
}

function coordinatorNameOf(record: PacketRowRecord): string {
  return String(record["coordinator_name" as keyof PacketRowRecord] ?? "");
}

function observationPage(page: PacketPageData): string {
  const observation = page.observation;
  const derived = observation["derived"] as { magnification: number; true_field_arcmin: number; exit_pupil_mm: number; orientation: { sentence: string; train: string } };
  const train = (observation["train"] ?? "straight") as string;
  const trueField = derived.true_field_arcmin;
  const observedAt = observation["observed_at_text"] as string | null;
  const utLine = observedAt
    ? `${escapeHtml(observedAt.slice(0, 10))} ${escapeHtml(observedAt.slice(11, 16))} UT`
    : "—";
  const localLine = observedAt
    ? `(${escapeHtml(String(observation["local_time"]))} local, UTC${escapeHtml(String(observation["local_offset"]))}, ${escapeHtml(String(observation["time_zone"]))})`
    : "";
  const lines: string[] = [];
  const line = (term: string, value: string) => lines.push(`<div><dt>${term}</dt><dd>${value}</dd></div>`);
  line("UT", `${utLine} ${localLine}`);
  line("Site", escapeHtml(String(observation["site_name"])));
  line("Seeing", `${escapeHtml(String(observation["seeing"] ?? "—"))}/10`);
  line("Transparency", `NELM ${escapeHtml(String(observation["transparency_nelm"] ?? "—"))}`);
  line("Telescope", `${escapeHtml(page.telescopeName)}, ${formatAperture(Number(page.apertureMm))} mm aperture`);
  line("Eyepiece", `${escapeHtml(page.eyepieceName)}${page.barlowName ? `, ${escapeHtml(page.barlowName)}` : ""} at ${derived.magnification}×`);
  line("True field", `${derived.true_field_arcmin}′ · Exit pupil: ${formatExitPupil(derived.exit_pupil_mm)} mm`);
  line("Orientation", escapeHtml(derived.orientation.sentence));
  line("Program rules", `edition ${page.row.edition}`);
  const kind = String(observation["kind"]);
  if (kind === "globular") {
    const concentration = observation["concentration_class"] as string | null;
    line("Concentration", concentration ? `class ${escapeHtml(concentration)}` : "not recorded");
  }
  if (kind === "double_star") {
    const separation = observation["pair_separation"];
    const pa = observation["pair_pa"];
    line("Pair", separation !== null && pa !== null ? `${escapeHtml(String(Number(separation).toFixed(1)))}′ at ${escapeHtml(String(Math.round(Number(pa))))}°` : "not measured");
  }
  const sketch = sketchSvg(page, trueField, train);
  return `
    <section class="page">
      <h2>${escapeHtml(page.row.designation)} — ${escapeHtml(String(observation["object_name"]))}</h2>
      <dl>${lines.join("")}</dl>
      ${sketch}
      <p class="desc">Description: ${withBreaks(String(observation["description"] ?? ""))}</p>
    </section>`;
}

function sketchSvg(page: PacketPageData, trueField: number, train: string): string {
  const hasSketch = page.strokesText !== null && page.strokesText !== "";
  const hasPair = page.observation["pair_primary"] !== null && page.observation["pair_secondary"] !== null;
  if (!hasSketch && !hasPair) return "";
  const strokes: StrokeFile | null = hasSketch ? parseStrokeFileText(page.strokesText!) : null;
  const half = trueField / 2;
  const radius = 150;
  const project = (point: readonly [number, number]): { x: number; y: number } => {
    const screen = skyToScreen(point, train as "straight", trueField);
    return { x: radius + screen.x * radius, y: radius + screen.y * radius };
  };
  const parts: string[] = [];
  if (strokes) {
    for (const stroke of strokes.strokes) {
      const d = stroke.points.map((point, index) => {
        const { x, y } = project(point);
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
      parts.push(`<path d="${d}" fill="none" stroke="#10131a" stroke-width="${stroke.width === "broad" ? 2.6 : stroke.width === "medium" ? 1.6 : 0.9}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
    for (const star of strokes.stars) {
      const { x, y } = project(star.at);
      const size = [1.6, 2.4, 3.3, 4.4, 5.6][star.brightness - 1] ?? 2;
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${size}" fill="#10131a"/>`);
    }
  }
  if (hasPair) {
    const primary = project(page.observation["pair_primary"] as readonly [number, number]);
    const secondary = project(page.observation["pair_secondary"] as readonly [number, number]);
    parts.push(`<line x1="${primary.x.toFixed(1)}" y1="${primary.y.toFixed(1)}" x2="${secondary.x.toFixed(1)}" y2="${secondary.y.toFixed(1)}" stroke="#10131a" stroke-width="0.8"/>`);
    parts.push(`<circle cx="${primary.x.toFixed(1)}" cy="${primary.y.toFixed(1)}" r="3.4" fill="none" stroke="#10131a" stroke-width="1"/>`);
    parts.push(`<circle cx="${secondary.x.toFixed(1)}" cy="${secondary.y.toFixed(1)}" r="3.4" fill="none" stroke="#10131a" stroke-width="1"/>`);
  }
  const info = trainByIdSentence(train);
  const { nx, ex } = compassPositions(train as "straight");
  return `
      <div class="sketch">
        <div class="circle"><svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg></div>
        <div class="compass">
          <div class="arrow"><span style="display:block;transform:translate(${nx.x}pt, ${nx.y}pt)">N ↑</span></div>
          <div class="arrow"><span style="display:block;transform:translate(${ex.x}pt, ${ex.y}pt)">E ${ex.side === "left" ? "←" : "→"}</span></div>
          <div>${escapeHtml(info)}</div>
        </div>
      </div>`;
}

function trainByIdSentence(train: string): string {
  if (train === "mirror_diagonal") return "North up, east right.";
  if (train === "erecting_prism") return "North up, east left.";
  return "North down, east right.";
}

function compassPositions(train: "straight" | "mirror_diagonal" | "erecting_prism"): { nx: { x: number; y: number }; ex: { x: number; y: number; side: "left" | "right" } } {
  switch (train) {
    case "straight":
      return { nx: { x: 0, y: 18 }, ex: { x: 0, y: 18, side: "right" } };
    case "mirror_diagonal":
      return { nx: { x: 0, y: 0 }, ex: { x: 0, y: 0, side: "right" } };
    case "erecting_prism":
      return { nx: { x: 0, y: 0 }, ex: { x: 0, y: 0, side: "left" } };
    default:
      return { nx: { x: 0, y: 18 }, ex: { x: 0, y: 18, side: "right" } };
  }
}

// Count the pages of a PDF from its own catalog objects.
export function countPdfPages(bytes: Uint8Array): number {
  const text = Buffer.from(bytes).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page[^s]/g);
  if (matches) return matches.length;
  const counted = text.match(/\/Count\s+(\d+)/g);
  if (counted) {
    let best = 0;
    for (const entry of counted) {
      const value = Number(/\/Count\s+(\d+)/.exec(entry)?.[1] ?? 0);
      if (value > best) best = value;
    }
    return best;
  }
  return 0;
}
