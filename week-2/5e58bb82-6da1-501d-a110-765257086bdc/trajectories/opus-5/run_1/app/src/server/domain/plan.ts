import { roundHalfUp } from '../../shared/numbers.js';
import type { LineKind, Position, SurveyOrder } from '../../shared/types.js';
import { chordAt, directions, spread } from './geometry.js';

export interface PlanSettings {
  survey_area: Position[];
  planned_depth_m: number;
  swath_ratio: number;
  overlap_pct: number;
  line_azimuth_deg: number;
  planned_speed_mps: number;
  survey_order: SurveyOrder;
}

export interface PlannedLine {
  label: string;
  label_num: number;
  kind: LineKind;
  start: Position;
  end: Position;
  length_m: number;
  /** The across-line offset of the line, measured from the area's smallest projection. */
  offset: number;
}

export interface DerivedPlan {
  swath_width_m: number;
  line_spacing_m: number;
  line_count: number;
  crossline_count: number;
  estimated_duration_s: number;
  lines: PlannedLine[];
}

export const PLAN_DEFAULTS = {
  overlap_pct: 20,
  swath_ratio: 4,
  line_azimuth_deg: 0,
  planned_speed_mps: 2.0,
  survey_order: '1a' as SurveyOrder,
};

function label(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(2, '0')}`;
}

/**
 * The one line-plan derivation. It answers the preview and is stored on the
 * mission at creation; nothing else derives lines, spacing or duration.
 */
export function derivePlan(settings: PlanSettings): DerivedPlan {
  const area = settings.survey_area;
  const swathWidth = settings.planned_depth_m * settings.swath_ratio;
  const spacing = swathWidth * (1 - settings.overlap_pct / 100);
  const { along, across } = directions(settings.line_azimuth_deg);

  const acrossSpan = spread(area, across);
  const alongSpan = spread(area, along);
  const acrossSpread = acrossSpan.max - acrossSpan.min;
  const alongSpread = alongSpan.max - alongSpan.min;

  const offsets: number[] = [];
  if (acrossSpread <= swathWidth) {
    offsets.push(acrossSpread / 2);
  } else {
    const count = 1 + Math.ceil((acrossSpread - swathWidth) / spacing);
    for (let i = 0; i < count; i += 1) {
      offsets.push(i === count - 1 ? acrossSpread - swathWidth / 2 : swathWidth / 2 + i * spacing);
    }
  }

  const lines: PlannedLine[] = [];
  let mainschemeLength = 0;
  offsets.forEach((offset, index) => {
    const chord = chordAt(area, along, across, acrossSpan.min + offset);
    if (!chord) return;
    mainschemeLength += chord.length;
    lines.push({
      label: label('L', index + 1),
      label_num: index + 1,
      kind: 'planned',
      start: chord.start,
      end: chord.end,
      length_m: chord.length,
      offset,
    });
  });

  const required = 0.05 * mainschemeLength;
  let crosslineOffsets: number[] = [];
  let crosslineLength = 0;
  for (let k = 1; ; k += 1) {
    const candidate: number[] = [];
    let total = 0;
    for (let j = 0; j < k; j += 1) {
      const offset = (alongSpread * (j + 1)) / (k + 1);
      const chord = chordAt(area, across, along, alongSpan.min + offset);
      if (!chord) continue;
      candidate.push(offset);
      total += chord.length;
    }
    if (total >= required || k >= 200) {
      crosslineOffsets = candidate;
      crosslineLength = total;
      break;
    }
  }

  crosslineOffsets.forEach((offset, index) => {
    const chord = chordAt(area, across, along, alongSpan.min + offset);
    if (!chord) return;
    lines.push({
      label: label('X', index + 1),
      label_num: index + 1,
      kind: 'crossline',
      start: chord.start,
      end: chord.end,
      length_m: chord.length,
      offset,
    });
  });

  const mainschemeCount = lines.filter((line) => line.kind === 'planned').length;
  const crosslineCount = crosslineOffsets.length;
  const runSeconds = (mainschemeLength + crosslineLength) / settings.planned_speed_mps;
  const turnSeconds = 60 * (mainschemeCount + crosslineCount - 1);

  return {
    swath_width_m: swathWidth,
    line_spacing_m: spacing,
    line_count: mainschemeCount,
    crossline_count: crosslineCount,
    estimated_duration_s: roundHalfUp(runSeconds + turnSeconds),
    lines,
  };
}

/** The direction of a line in degrees: the azimuth, turned 90° for a crossline. */
export function lineDirectionDeg(kind: LineKind, azimuthDeg: number): number {
  return kind === 'crossline' ? azimuthDeg + 90 : azimuthDeg;
}
