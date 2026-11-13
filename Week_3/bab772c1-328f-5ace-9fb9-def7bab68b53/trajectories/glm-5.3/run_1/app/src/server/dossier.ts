// The dossier document, built from the public shapes. Values use the display
// formats in the requester's units.

import {
  epochMsToDayOfYear,
  formatAltitude,
  formatLatitude,
  formatLongitude,
  formatMetLabel,
  formatSpeed,
  isoToDayOfYear,
  landmarkRangeM,
  type DistanceUnit,
  type SpeedUnit,
  formatFixed,
  metresToDistance,
} from "../shared/format.js";
import { csvCell } from "./csv.js";
import type { EventRow, LandmarkRow, MissionRow, Perilune } from "./store.js";
import type { TrackSample } from "./store.js";

export interface ReferenceLineParts {
  target: string;
  state: string;
  vectorCount: number;
}

export function referenceLine(target: string | null, state: string | null, vectorCount: number | null): string {
  if (!target) return "No reference target";
  if (state === "fetching") return `Reference ${target}: fetching`;
  if (state === "unavailable") return `Reference ${target}: unavailable`;
  const count = vectorCount ?? 0;
  const vectorWord = count === 1 ? "1 vector" : `${count} vectors`;
  return `Reference ${target}: ready, ${vectorWord}`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface DossierInput {
  mission: MissionRow;
  perilune: Perilune | null;
  periluneSample: TrackSample | null;
  events: Array<EventRow & { sample: { altitude_m: number; speed_m_s: number; residual_m: number | null } }>;
  landmarks: LandmarkRow[];
  reference: ReferenceLineParts | null;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  includeNotes: boolean;
  nowMs: number;
}

export function buildDossierHtml(input: DossierInput): string {
  const { mission, distanceUnit: du, speedUnit: su } = input;
  const label = (met: number) => formatMetLabel(met);

  const sections: string[] = [];

  sections.push(`<h1>${esc(mission.name)}</h1>`);
  sections.push(`<p class="sub">Mission dossier · Epoch ${esc(isoToDayOfYear(mission.epoch_utc))}</p>`);

  // Perilune.
  sections.push("<h2>Perilune</h2>");
  if (input.perilune && input.periluneSample) {
    const s = input.periluneSample;
    const lines = [
      `MET ${esc(label(s.met))}`,
      `GMT ${esc(epochMsToDayOfYear(s.utc_ms))}`,
      `LAT ${esc(formatLatitude(s.lat_deg))}`,
      `LON ${esc(formatLongitude(s.lon_deg))}`,
      `ALT ${esc(formatAltitude(s.altitude_m, du))}`,
      `SPD ${esc(formatSpeed(s.speed_m_s, su))}`,
    ];
    if (mission.reference_target && mission.reference_state === "ready") {
      lines.push(
        `ΔR ${s.residual_m === null ? "—" : esc(formatAltitude(s.residual_m, du))}`,
      );
    }
    sections.push(`<p class="plate">${lines.join("<br>")}</p>`);
  } else {
    sections.push('<p class="plate">No samples yet</p>');
  }

  // Events.
  sections.push("<h2>Events</h2>");
  if (input.events.length === 0) {
    sections.push('<p class="plate">No events</p>');
  } else {
    const tableRows = input.events
      .map((event) => {
        const tds: string[] = [];
        tds.push(`<td>${esc(label(event.met))}</td>`);
        tds.push(`<td>${esc(epochMsToDayOfYear(mission.epoch_ms + event.met * 1000))}</td>`);
        tds.push(`<td>${esc(event.title)}</td>`);
        tds.push(
          `<td>${esc(formatAltitude(event.sample.altitude_m, du))}</td>`,
        );
        tds.push(`<td>${esc(formatSpeed(event.sample.speed_m_s, su))}</td>`);
        if (input.includeNotes) tds.push(`<td>${esc(event.note)}</td>`);
        return `<tr>${tds.join("")}</tr>`;
      })
      .join("");
    const head = input.includeNotes
      ? "<tr><th>MET</th><th>GMT</th><th>Title</th><th>Altitude</th><th>Speed</th><th>Note</th></tr>"
      : "<tr><th>MET</th><th>GMT</th><th>Title</th><th>Altitude</th><th>Speed</th></tr>";
    sections.push(`<table>${head}${tableRows}</table>`);
  }

  // Landmarks.
  sections.push("<h2>Landmarks</h2>");
  if (input.landmarks.length === 0) {
    sections.push('<p class="plate">No landmarks</p>');
  } else {
    const items = input.landmarks
      .map((landmark) => {
        let range = "—";
        if (input.periluneSample) {
          const metres = landmarkRangeM(
            input.periluneSample.lat_deg,
            input.periluneSample.lon_deg,
            landmark.lat_deg,
            landmark.lon_deg,
          );
          range = formatAltitude(metres, du);
        }
        return `<p class="plate">${esc(landmark.name)} ${esc(formatLatitude(landmark.lat_deg))}, ${esc(
          formatLongitude(landmark.lon_deg),
        )}, range ${esc(range)} at perilune</p>`;
      })
      .join("");
    sections.push(items);
  }

  // Reference.
  sections.push("<h2>Reference</h2>");
  sections.push(
    `<p class="plate">${esc(
      referenceLine(
        mission.reference_target,
        mission.reference_state,
        mission.reference_vector_count,
      ),
    )}</p>`,
  );

  const footer = `Generated ${esc(epochMsToDayOfYear(input.nowMs))} · Perilune Ledger`;

  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${esc(mission.name)}</title>
<style>
@font-face { font-family: "Archivo"; src: url("Archivo.ttf"); }
@font-face { font-family: "IBM Plex Sans"; src: url("IBMPlexSans.ttf"); }
@font-face { font-family: "IBM Plex Mono"; src: url("IBMPlexMono-Regular.ttf"); }
body { font-family: "IBM Plex Sans", sans-serif; margin: 24px; color: #26221c; }
h1 { font-family: "Archivo", sans-serif; font-size: 22pt; margin: 0 0 4pt; }
h2 { font-family: "Archivo", sans-serif; font-size: 13pt; margin: 16pt 0 4pt; border-bottom: 0.5pt solid #9a928a; padding-bottom: 2pt; }
.sub { color: #4d4740; font-size: 10pt; margin: 0 0 8pt; }
p { margin: 2pt 0; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; }
th, td { text-align: left; padding: 3pt 6pt; border-bottom: 0.5pt solid #c9c2ba; }
th { font-family: "Archivo", sans-serif; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5pt; }
td, .plate, .num { font-family: "IBM Plex Mono", monospace; }
.footer { position: fixed; bottom: 12pt; left: 24px; right: 24px; font-family: "IBM Plex Mono", monospace; font-size: 8pt; color: #6b645c; border-top: 0.5pt solid #c9c2ba; padding-top: 4pt; }
</style></head>
<body>
${sections.join("\n")}
<div class="footer">${footer}</div>
</body></html>`;
}

export function dossierFilename(missionName: string): string {
  return `${missionName}-dossier.pdf`;
}

export function buildEventCsv(
  events: Array<{
    met: number;
    title: string;
    sample: { altitude_m: number; speed_m_s: number; residual_m: number | null };
  }>,
  distanceUnit: DistanceUnit,
  speedUnit: SpeedUnit,
): string {
  const header = `met_label,met_seconds,title,altitude_${distanceUnit},speed_${speedUnit},residual_${distanceUnit}`;
  const lines = [`${header}\r\n`];
  for (const event of events) {
    const altitude = csvCell(formatFixed(metresToDistance(event.sample.altitude_m, distanceUnit), 1), false);
    const speed = csvCell(
      String(Math.round(event.sample.speed_m_s / (speedUnit === "m_s" ? 1 : 0.3048))),
      false,
    );
    const residual =
      event.sample.residual_m === null
        ? ""
        : csvCell(
            formatFixed(metresToDistance(event.sample.residual_m, distanceUnit), 1),
            false,
          );
    const label = csvCell(formatMetLabel(event.met), true);
    const met = csvCell(String(event.met), false);
    const title = csvCell(event.title, true);
    lines.push(`${label},${met},${title},${altitude},${speed},${residual}\r\n`);
  }
  return lines.join("");
}
