/** The mission dossier: server-built HTML for the PDF renderer. */

import { formatDoy } from "../shared/doy.js";
import { readoutLines } from "../shared/readout.js";
import { referenceLine } from "../shared/copy.js";
import { formatDistance, formatLatitude, formatLongitude, formatSpeed } from "../shared/units.js";
import { surfaceRange } from "../shared/geometry.js";
import type { DistanceUnit, SpeedUnit } from "../shared/units.js";
import type { Landmark, MissionEvent, Reference } from "../shared/model.js";
import type { PerilunePlate } from "./domain/missionRead.js";
import { escapeHtml } from "./html.js";

type DossierModel = {
  missionName: string;
  epochMs: number;
  perilune: PerilunePlate | null;
  events: readonly MissionEvent[];
  landmarks: readonly Landmark[];
  reference: Reference | null;
  distanceUnit: DistanceUnit;
  speedUnit: SpeedUnit;
  withNote: boolean;
  nowMs: number;
};

const FONT_FACES = `
@font-face { font-family: "Archivo"; src: url("archivo-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "Archivo"; src: url("archivo-latin-600-normal.woff2") format("woff2"); font-weight: 600; }
@font-face { font-family: "IBM Plex Sans"; src: url("ibm-plex-sans-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "IBM Plex Sans"; src: url("ibm-plex-sans-latin-600-normal.woff2") format("woff2"); font-weight: 600; }
@font-face { font-family: "IBM Plex Mono"; src: url("ibm-plex-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400; }
@font-face { font-family: "IBM Plex Mono"; src: url("ibm-plex-mono-latin-500-normal.woff2") format("woff2"); font-weight: 500; }
`;

function perilunePart(model: DossierModel): string {
  if (!model.perilune) {
    return "<p>No samples yet</p>";
  }
  const lines = readoutLines(
    {
      met_label: model.perilune.met_label,
      utc_ms: model.perilune.utc_ms,
      lat_deg: model.perilune.lat_deg,
      lon_deg: model.perilune.lon_deg,
      altitude_m: model.perilune.altitude_m,
      speed_m_s: model.perilune.speed_m_s,
      residual_m: model.perilune.residual_m,
    },
    {
      distanceUnit: model.distanceUnit,
      speedUnit: model.speedUnit,
      hasReference: model.reference !== null,
      landmarks: [],
    },
  );
  return `<dl class="plate">${lines
    .map(
      (line) => `<div><dt>${escapeHtml(line.label)}</dt><dd>${escapeHtml(line.value)}</dd></div>`,
    )
    .join("")}</dl>`;
}

function eventsPart(model: DossierModel): string {
  if (model.events.length === 0) {
    return "<p>No events</p>";
  }
  const headings = [
    "MET",
    "GMT",
    "Title",
    "Altitude",
    "Speed",
    ...(model.withNote ? ["Note"] : []),
  ];
  const rows = model.events
    .map((event) => {
      const cells = [
        event.met_label,
        formatDoy(model.epochMs + event.met * 1000),
        event.title,
        formatDistance(event.sample.altitude_m, model.distanceUnit),
        formatSpeed(event.sample.speed_m_s, model.speedUnit),
        ...(model.withNote ? [event.note ?? ""] : []),
      ];
      return `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<table><thead><tr>${headings
    .map((heading) => `<th>${heading}</th>`)
    .join("")}</tr></thead><tbody>${rows}</tbody></table>`;
}

function landmarksPart(model: DossierModel): string {
  if (model.landmarks.length === 0) {
    return "<p>No landmarks</p>";
  }
  return model.landmarks
    .map((landmark) => {
      const range = model.perilune
        ? surfaceRange(
            model.perilune.lat_deg,
            model.perilune.lon_deg,
            landmark.lat_deg,
            landmark.lon_deg,
          )
        : 0;
      return `<p>${escapeHtml(
        `${landmark.name} ${formatLatitude(landmark.lat_deg)}, ${formatLongitude(
          landmark.lon_deg,
        )}, range ${formatDistance(range, model.distanceUnit)} at perilune`,
      )}</p>`;
    })
    .join("");
}

export function dossierHtml(model: DossierModel): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(model.missionName)}</title>
<style>
${FONT_FACES}
@page { size: A4 portrait; }
body { font-family: "IBM Plex Sans", sans-serif; color: #17150f; background: #d9d4c7; font-size: 10pt; margin: 0; }
h1 { font-family: "Archivo", sans-serif; font-size: 20pt; margin: 0 0 4pt; }
h2 { font-family: "Archivo", sans-serif; font-size: 13pt; margin: 14pt 0 4pt; border-bottom: 1px solid #8d8678; }
.plate div { display: flex; gap: 8pt; font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
.plate dt { width: 120pt; text-transform: uppercase; font-size: 8pt; padding-top: 1pt; }
.plate dd { margin: 0; }
table { border-collapse: collapse; width: 100%; font-size: 9pt; }
th, td { border-bottom: 1px solid #8d8678; text-align: left; padding: 3pt 4pt; }
td:nth-child(1), td:nth-child(2), td:nth-child(4), td:nth-child(5) { font-family: "IBM Plex Mono", monospace; font-variant-numeric: tabular-nums; }
.footer { position: fixed; bottom: 2mm; left: 0; right: 0; font-size: 8pt; font-family: "IBM Plex Mono", monospace; }
p { margin: 3pt 0; }
</style>
</head>
<body>
<h1>${escapeHtml(model.missionName)}</h1>
<p>${escapeHtml(`Mission dossier \u00b7 Epoch ${formatDoy(model.epochMs)}`)}</p>
<h2>Perilune</h2>
${perilunePart(model)}
<h2>Events</h2>
${eventsPart(model)}
<h2>Landmarks</h2>
${landmarksPart(model)}
<h2>Reference</h2>
<p>${escapeHtml(referenceLine(model.reference))}</p>
<div class="footer">${escapeHtml(`Generated ${formatDoy(model.nowMs)} \u00b7 Perilune Ledger`)}</div>
</body>
</html>
`;
}
