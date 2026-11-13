import { formatMl, type Ml } from './decimal.ts';
import type { Period } from './period.ts';
import { formatInstant } from './time.ts';

/** The one regulator pack document format. */

export interface PackStrokeLine {
  turnout: string;
  kind: 'start' | 'finish';
  fromMlDay: Ml;
  toMlDay: Ml;
  operatorCode: string;
  committedAt: Date;
}

export interface PackWindowLine {
  windowId: string;
  channelName: string;
  label: string;
  effectiveCapMlDay: Ml;
  capVolumeMl: Ml;
  committedMl: Ml;
  deliveredMl: Ml;
  restrictionCapMlDay: Ml | null;
  restrictionEffectiveAt: Date | null;
  strokes: readonly PackStrokeLine[];
}

export function packDocument(period: Period, signatory: string, windows: readonly PackWindowLine[]): string {
  const lines: string[] = [`Wirrinbah Water Trust delivery pack ${period.from} to ${period.to}`];
  for (const window of windows) {
    let line =
      `WINDOW ${window.windowId} ${window.channelName} | ${window.label}` +
      ` | cap ${formatMl(window.effectiveCapMlDay)} ML/day` +
      ` | volume ${formatMl(window.capVolumeMl)} ML` +
      ` | committed ${formatMl(window.committedMl)} ML` +
      ` | delivered ${formatMl(window.deliveredMl)} ML`;
    if (window.restrictionCapMlDay !== null && window.restrictionEffectiveAt !== null) {
      line += ` | restricted ${formatMl(window.restrictionCapMlDay)} ML/day from ${formatInstant(window.restrictionEffectiveAt)}`;
    }
    lines.push(line);
    for (const stroke of window.strokes) {
      lines.push(
        `STROKE ${stroke.turnout} ${stroke.kind} ${formatMl(stroke.fromMlDay)} -> ${formatMl(stroke.toMlDay)} ML/day` +
          ` | operator ${stroke.operatorCode} | ${formatInstant(stroke.committedAt)}`,
      );
    }
  }
  lines.push(`Signed by ${signatory} for Wirrinbah Water Trust`);
  return `${lines.join('\n')}\n`;
}
