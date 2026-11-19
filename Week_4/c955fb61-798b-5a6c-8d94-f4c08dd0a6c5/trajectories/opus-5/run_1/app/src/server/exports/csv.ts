import type { Schedule } from '../domain/schedule.js';
import type { ProjectState } from '../repo.js';
import { canonicalFor } from '../../shared/predecessors.js';
import { formatHours } from '../../shared/hours.js';

const HEADER =
  'Row,Name,Type,Group,Start,End,Duration,Percent complete,Critical,Assignees,Predecessors,Baseline start,Baseline end,Variance';

/** A cell that could be read as a formula is written with a leading apostrophe. */
function neutralise(value: string): string {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function quote(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function renderCsv(state: ProjectState, schedule: Schedule): Buffer {
  const names = new Map(schedule.items.map((item) => [item.id, item.name]));
  const rowOf = new Map(schedule.items.map((item) => [item.id, item.row]));
  const lines: string[] = [HEADER];

  for (const item of schedule.items) {
    const assignees = [...item.assignees]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((assignee) => `${assignee.name} (${formatHours(assignee.hours)})`)
      .join('; ');
    const cells = [
      String(item.row),
      neutralise(item.name),
      item.kind,
      item.group ? neutralise(names.get(item.group) ?? '') : '',
      item.start ?? '',
      item.end ?? '',
      String(item.duration),
      String(item.percent),
      item.critical ? 'yes' : 'no',
      neutralise(assignees),
      item.kind === 'group' ? '' : canonicalFor(item.id, state.links, rowOf),
      item.baseline?.start ?? '',
      item.baseline?.end ?? '',
      item.baseline ? String(item.baseline.variance) : '',
    ];
    lines.push(cells.map(quote).join(','));
  }

  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}
