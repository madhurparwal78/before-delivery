import type { LinkType } from '../../shared/types.js';
import { ALERTS, noRowMessage, rowTwiceMessage, loopMessage } from '../../shared/copy.js';
import type { PredecessorEntry } from '../../shared/predecessors.js';
import type { StoredLink } from './schedule.js';
import { findLoopPath } from './loops.js';

export interface RowItem {
  id: string;
  row: number;
  name: string;
  kind: 'task' | 'milestone' | 'group';
}

export type PredecessorParse =
  | { ok: true; entries: PredecessorEntry[] }
  | { ok: false; message: string };

const ENTRY = /^(\d+)(FS|SS|FF|SF)?([+-]\d+)?$/;

/**
 * Parse a Predecessors cell. Entries are checked left to right for syntax, unknown row, self,
 * group, lag range and repeated row, then the whole cell is checked for a loop.
 */
export function parsePredecessors(
  text: string,
  items: readonly RowItem[],
  selfId: string,
  allLinks: readonly StoredLink[],
): PredecessorParse {
  const trimmed = text.replace(/\s+/g, '');
  if (trimmed === '') return { ok: true, entries: [] };

  const byRow = new Map(items.map((item) => [item.row, item]));
  const entries: PredecessorEntry[] = [];
  const seenRows = new Set<number>();

  for (const raw of trimmed.split(',')) {
    const match = ENTRY.exec(raw.toUpperCase());
    if (!match) return { ok: false, message: ALERTS.predecessorSyntax };
    const row = Number(match[1]);
    const type = (match[2] ?? 'FS') as LinkType;
    const lag = match[3] ? Number(match[3]) : 0;
    const predecessor = byRow.get(row);
    if (!predecessor) return { ok: false, message: noRowMessage(row) };
    if (predecessor.id === selfId) return { ok: false, message: ALERTS.selfLink };
    if (predecessor.kind === 'group') return { ok: false, message: ALERTS.groupLink };
    if (lag < -30 || lag > 30) return { ok: false, message: ALERTS.lagRange };
    if (seenRows.has(row)) return { ok: false, message: rowTwiceMessage(row) };
    seenRows.add(row);
    entries.push({ row, type, lag });
  }

  const nameOf = new Map(items.map((item) => [item.id, item.name]));
  const rowOf = new Map(items.map((item) => [item.id, item.row]));
  const base: StoredLink[] = allLinks.filter((link) => link.to !== selfId);
  for (const entry of entries) {
    const from = byRow.get(entry.row)!.id;
    const path = findLoopPath(from, selfId, base, rowOf);
    if (path) {
      return { ok: false, message: loopMessage(path.map((id) => nameOf.get(id)!)) };
    }
    base.push({ id: `pending-${from}`, from, to: selfId, type: entry.type, lag: entry.lag });
  }

  return { ok: true, entries };
}
