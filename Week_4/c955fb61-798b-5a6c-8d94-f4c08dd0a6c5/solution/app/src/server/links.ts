import { LAG_LIMIT, type LinkType } from "../shared/types";

interface LinkEnds {
  from: string;
  to: string;
}

interface PredecessorEntry extends LinkEnds {
  type: LinkType;
  lag: number;
}

export class PredecessorError extends Error {}

/** The loop check: the path a new link `from -> to` would close, or null when it closes none. */
export function loopPath(existing: readonly LinkEnds[], rowOf: (id: string) => number, from: string, to: string): string[] | null {
  const outgoing = new Map<string, string[]>();
  for (const link of existing) outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
  for (const successors of outgoing.values()) successors.sort((a, b) => rowOf(a) - rowOf(b));
  const cameFrom = new Map<string, string | null>([[to, null]]);
  const queue = [to];
  for (let next = 0; next < queue.length && !cameFrom.has(from); next++) {
    for (const successor of outgoing.get(queue[next]) ?? []) {
      if (!cameFrom.has(successor)) {
        cameFrom.set(successor, queue[next]);
        queue.push(successor);
      }
    }
  }
  if (!cameFrom.has(from)) return null;
  const back: string[] = [];
  for (let id: string | null = from; id !== null; id = cameFrom.get(id) ?? null) back.unshift(id);
  return [from, ...back];
}

export function loopMessage(path: readonly string[], nameOf: (id: string) => string): string {
  return `That link would make the project wait on itself: ${path.map(nameOf).join(" -> ")}.`;
}

interface PredecessorTarget {
  id: string;
  isGroup: boolean;
}

const ENTRY = /^(\d+)(FS|SS|FF|SF)?([+-]\d+)?$/i;

/**
 * Parses a Predecessors cell for `itemId`. Entries are checked left to right for syntax, unknown row, self,
 * group, lag range and repeated row; the whole cell is then checked for a loop. The first failure throws.
 */
export function parsePredecessors(
  text: string,
  itemId: string,
  targetOfRow: (row: number) => PredecessorTarget | undefined,
  otherLinks: readonly LinkEnds[],
  rowOf: (id: string) => number,
  nameOf: (id: string) => string,
): PredecessorEntry[] {
  const compact = text.replace(/\s+/g, "");
  const entries: PredecessorEntry[] = [];
  const seen = new Set<string>();
  for (const part of compact === "" ? [] : compact.split(",")) {
    const match = ENTRY.exec(part);
    if (!match) throw new PredecessorError("Write predecessors like 2FS+1, 3SS-2.");
    const row = Number(match[1]);
    const target = targetOfRow(row);
    if (!target) throw new PredecessorError(`There is no row ${row}.`);
    if (target.id === itemId) throw new PredecessorError("A task cannot wait for itself.");
    if (target.isGroup) throw new PredecessorError("Groups cannot be linked.");
    const lag = match[3] ? Number(match[3]) : 0;
    if (Math.abs(lag) > LAG_LIMIT) throw new PredecessorError(`Lag must be between -${LAG_LIMIT} and ${LAG_LIMIT} working days.`);
    if (seen.has(target.id)) throw new PredecessorError(`Row ${row} is listed twice.`);
    seen.add(target.id);
    const type = (match[2] ?? "FS").toUpperCase() as LinkType;
    entries.push({ from: target.id, to: itemId, type, lag });
  }
  for (const entry of entries) {
    const path = loopPath([...otherLinks, ...entries], rowOf, entry.from, itemId);
    if (path) throw new PredecessorError(loopMessage(path, nameOf));
  }
  return entries;
}
