import { markdownHeadings } from "../../shared/headings";
import { shownSource, shownType } from "./model";
import type { CellModel } from "./model";

interface Entry {
  cellId: string;
  number: string;
  text: string;
}

/** The table of contents: every markdown heading in order, numbered by the counter of each level from the shallowest
 *  level used down to its own, joined by dots. A level not yet seen under its parent counts as 0. */
export function contentsOf(cells: CellModel[]): Entry[] {
  const found = cells.flatMap((cell) => (shownType(cell) === "markdown" ? markdownHeadings(shownSource(cell)).map((h) => ({ ...h, cellId: cell.server.id })) : []));
  if (found.length === 0) return [];
  const top = Math.min(...found.map((h) => h.depth));
  const counters = new Array<number>(7).fill(0);
  return found.map((heading) => {
    counters[heading.depth] = (counters[heading.depth] as number) + 1;
    for (let level = heading.depth + 1; level <= 6; level++) counters[level] = 0;
    return { cellId: heading.cellId, number: counters.slice(top, heading.depth + 1).join("."), text: heading.text };
  });
}
