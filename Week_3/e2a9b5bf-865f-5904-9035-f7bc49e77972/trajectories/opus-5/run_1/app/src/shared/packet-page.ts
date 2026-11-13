import { formatAperture, formatExitPupil } from './optics.js';
import { formatSeparation } from './pair.js';
import { skyToPixel } from './projection.js';
import type { MeasuredPair, StrokeFile, TrainId } from './types.js';

export interface CoverPage {
  kind: 'cover';
  number: number;
  program_name: string;
  display_name: string;
  email: string;
  row_count: number;
  coordinator_name: string;
}

export interface RowPage {
  kind: 'row';
  designation: string;
  object_name: string;
  ut_date: string;
  ut_time: string;
  local_time: string;
  local_offset: string;
  time_zone: string;
  site_name: string;
  seeing: number;
  transparency_nelm: number;
  telescope_name: string;
  aperture_mm: number;
  eyepiece_name: string;
  barlow_name: string | null;
  magnification: number;
  true_field_arcmin: number;
  exit_pupil_mm: number;
  orientation_sentence: string;
  train: TrainId;
  edition: number;
  is_globular: boolean;
  concentration_class: string | null;
  is_double_star: boolean;
  pair: MeasuredPair | null;
  description: string;
  sketch: StrokeFile | null;
}

export type PacketPage = CoverPage | RowPage;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STROKE_WIDTH_UNITS: Record<string, number> = { fine: 0.006, medium: 0.012, broad: 0.022 };
const STAR_RADII: Record<number, number> = {
  1: 0.009,
  2: 0.014,
  3: 0.02,
  4: 0.027,
  5: 0.035,
};

/** The sketch in its own train's projection, graphite on white, with the compass. */
function sketchSvg(page: RowPage): string {
  const parts: string[] = [];
  const place = (east: number, north: number): string => {
    const point = skyToPixel([east, north], page.train, page.true_field_arcmin, 1);
    return `${point.x.toFixed(4)} ${point.y.toFixed(4)}`;
  };
  parts.push('<circle cx="0" cy="0" r="1" fill="#ffffff" stroke="#2b2b33" stroke-width="0.006"/>');
  if (page.sketch) {
    for (const stroke of page.sketch.strokes) {
      if (stroke.points.length === 0) continue;
      const path = stroke.points
        .map((point, index) => `${index === 0 ? 'M' : 'L'}${place(point[0], point[1])}`)
        .join(' ');
      parts.push(
        `<path d="${path}" fill="none" stroke="#2b2b33" stroke-linecap="round" ` +
          `stroke-linejoin="round" stroke-width="${STROKE_WIDTH_UNITS[stroke.width] ?? 0.012}"/>`,
      );
    }
    for (const star of page.sketch.stars) {
      const point = skyToPixel(star.at, page.train, page.true_field_arcmin, 1);
      parts.push(
        `<circle cx="${point.x.toFixed(4)}" cy="${point.y.toFixed(4)}" ` +
          `r="${STAR_RADII[star.brightness] ?? 0.02}" fill="#2b2b33"/>`,
      );
    }
  }
  if (page.pair) {
    const primary = skyToPixel(page.pair.primary, page.train, page.true_field_arcmin, 1);
    const secondary = skyToPixel(page.pair.secondary, page.train, page.true_field_arcmin, 1);
    parts.push(
      `<line x1="${primary.x.toFixed(4)}" y1="${primary.y.toFixed(4)}" ` +
        `x2="${secondary.x.toFixed(4)}" y2="${secondary.y.toFixed(4)}" ` +
        'stroke="#2b2b33" stroke-width="0.006"/>',
    );
    for (const point of [primary, secondary]) {
      parts.push(
        `<circle cx="${point.x.toFixed(4)}" cy="${point.y.toFixed(4)}" r="0.03" fill="none" ` +
          'stroke="#2b2b33" stroke-width="0.006"/>',
      );
    }
  }
  // The compass marks sit at the edge of the field in the same projection.
  const half = page.true_field_arcmin / 2;
  const north = skyToPixel([0, half * 0.86], page.train, page.true_field_arcmin, 1);
  const east = skyToPixel([half * 0.86, 0], page.train, page.true_field_arcmin, 1);
  parts.push(
    `<text x="${north.x.toFixed(4)}" y="${north.y.toFixed(4)}" font-size="0.1" ` +
      'text-anchor="middle" dominant-baseline="middle" fill="#2b2b33">N</text>',
  );
  parts.push(
    `<text x="${east.x.toFixed(4)}" y="${east.y.toFixed(4)}" font-size="0.1" ` +
      'text-anchor="middle" dominant-baseline="middle" fill="#2b2b33">E</text>',
  );
  return `<svg class="sketch" viewBox="-1.08 -1.08 2.16 2.16">${parts.join('')}</svg>`;
}

function descriptionClass(description: string): string {
  if (description.length > 2500) return 'description tiny';
  if (description.length > 1200) return 'description small';
  return 'description';
}

function rowLines(page: RowPage): string[] {
  const eyepiece =
    `Eyepiece: ${page.eyepiece_name}` +
    (page.barlow_name ? `, ${page.barlow_name}` : '') +
    ` at ${page.magnification}×`;
  const lines = [
    `UT: ${page.ut_date} ${page.ut_time} UT (${page.local_time} local, UTC${page.local_offset}, ${page.time_zone})`,
    `Site: ${page.site_name}`,
    `Seeing: ${page.seeing}/10`,
    `Transparency: NELM ${page.transparency_nelm}`,
    `Telescope: ${page.telescope_name}, ${formatAperture(page.aperture_mm)} mm aperture`,
    eyepiece,
    `True field: ${page.true_field_arcmin}′ · Exit pupil: ${formatExitPupil(page.exit_pupil_mm)} mm`,
    `Orientation: ${page.orientation_sentence}`,
    `Program rules: edition ${page.edition}`,
  ];
  if (page.is_globular) {
    lines.push(
      page.concentration_class
        ? `Concentration: class ${page.concentration_class}`
        : 'Concentration: not recorded',
    );
  }
  if (page.is_double_star) {
    lines.push(
      page.pair
        ? `Pair: ${formatSeparation(page.pair.separation_arcmin)}′ at ${page.pair.position_angle_deg}°`
        : 'Pair: not measured',
    );
  }
  return lines;
}

/** The inner content of one page, identical in the PDF and the Paper preview. */
export function packetPageContent(page: PacketPage): string {
  if (page.kind === 'cover') {
    return (
      '<div class="cover">' +
      `<h1>Observing log packet ${page.number}</h1>` +
      `<p class="program">${escapeHtml(page.program_name)}</p>` +
      `<p>Observer: ${escapeHtml(page.display_name)} (${escapeHtml(page.email)})</p>` +
      `<p>Objects: ${page.row_count}</p>` +
      `<p>Coordinator: ${escapeHtml(page.coordinator_name)}</p>` +
      '</div>'
    );
  }
  const showSketch = page.sketch !== null || page.pair !== null;
  return (
    '<div class="row-page">' +
    `<h2>${escapeHtml(page.designation)} — ${escapeHtml(page.object_name)}</h2>` +
    '<div class="columns">' +
    `<div class="facts">${rowLines(page)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('')}</div>` +
    (showSketch ? `<div class="figure">${sketchSvg(page)}</div>` : '') +
    '</div>' +
    `<div class="${descriptionClass(page.description)}">` +
    `<span class="label">Description:</span> ${escapeHtml(page.description)}</div>` +
    '</div>'
  );
}

export const PACKET_PAGE_WIDTH_IN = 8.5;
export const PACKET_PAGE_HEIGHT_IN = 11;

/** The one stylesheet for packet pages, so paper and preview share a layout. */
export function packetPageCss(): string {
  return `
.lowlamp-page {
  width: ${PACKET_PAGE_WIDTH_IN}in;
  height: ${PACKET_PAGE_HEIGHT_IN}in;
  box-sizing: border-box;
  padding: 0.5in;
  background: #ffffff;
  color: #14141c;
  font-family: Sora, system-ui, sans-serif;
  font-size: 10pt;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  position: relative;
}
.lowlamp-page h1 { font-size: 22pt; font-weight: 600; margin: 0 0 0.18in; }
.lowlamp-page h2 { font-size: 15pt; font-weight: 600; margin: 0 0 0.14in; }
.lowlamp-page p { margin: 0 0 0.055in; }
.lowlamp-page .cover { padding-top: 1.6in; }
.lowlamp-page .cover .program { font-size: 13pt; margin-bottom: 0.3in; }
.lowlamp-page .columns { display: flex; gap: 0.25in; align-items: flex-start; }
.lowlamp-page .facts { flex: 1 1 auto; min-width: 0; }
.lowlamp-page .figure { flex: 0 0 2.5in; }
.lowlamp-page .sketch { width: 2.5in; height: 2.5in; display: block; }
.lowlamp-page .description {
  margin-top: 0.18in;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: pre-wrap;
}
.lowlamp-page .description.small { font-size: 8pt; line-height: 1.25; }
.lowlamp-page .description.tiny { font-size: 7pt; line-height: 1.2; }
.lowlamp-page .description .label { font-weight: 600; }
`;
}
