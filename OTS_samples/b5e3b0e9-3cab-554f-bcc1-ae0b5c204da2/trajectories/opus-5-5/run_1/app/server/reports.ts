import { clockText } from '../shared/time.js';
import type { LiveSession } from './live.js';
import { buildPdf } from './pdf.js';
import { buildDebrief } from './sim/score.js';

function csvField(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(session: LiveSession): Buffer {
  const state = session.engine.state;
  const debrief = buildDebrief(session.engine);
  const lines = ['sim_time,position,kind,callsign,rule,penalty,text'];
  for (const row of state.log) {
    const alert = row.kind === 'alert';
    lines.push(
      [
        clockText(row.simTime),
        row.position,
        row.kind,
        row.kind === 'note' ? null : row.callsign,
        alert ? row.rule : null,
        alert ? row.penalty : null,
        row.text,
      ]
        .map(csvField)
        .join(','),
    );
  }
  lines.push([clockText(state.endTime ?? state.now), 'INS', 'score', '', '', '', `Score ${debrief.score} of 100`].map(csvField).join(','));
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

const TIMELINE_ROWS_PER_PAGE = 30;

export function buildReportPdf(session: LiveSession): Buffer {
  const debrief = buildDebrief(session.engine);
  const seat = (position: 'GND' | 'TWR') => `${session.seats[position]?.name ?? 'none'} (${position})`;
  const first = [
    'Runup Bay debrief',
    `Scenario: ${session.row.scenario.name}`,
    `Aerodrome: ${session.row.aerodrome_name}`,
    `Students: ${seat('GND')}, ${seat('TWR')}`,
    `Score: ${debrief.score} of 100`,
    `Result: ${debrief.passed ? 'Passed' : 'Not passed'}`,
    ...debrief.breakdown.map((row) => `${row.simTime} ${row.rule} ${row.text} -${row.penalty}`),
    `Total ${debrief.score}`,
  ];
  const timeline: string[][] = [];
  for (let i = 0; i < debrief.log.length; i += TIMELINE_ROWS_PER_PAGE) {
    timeline.push(
      debrief.log.slice(i, i + TIMELINE_ROWS_PER_PAGE).map((row) => `${row.simTime} ${row.position} ${row.kind} ${row.text}`),
    );
  }
  const pages = [first, ...timeline];
  return buildPdf(pages.map((lines, i) => [...lines, `Training only - page ${i + 1} of ${pages.length}`]));
}
