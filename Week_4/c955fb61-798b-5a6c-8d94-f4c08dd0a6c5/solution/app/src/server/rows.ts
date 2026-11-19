/** Row order: groups are followed by their items; at the top level the units are ungrouped items and whole groups. */
export interface RowPlace {
  id: string;
  group: string | null;
}

function topLevelUnits(rows: readonly RowPlace[]): RowPlace[][] {
  const units: RowPlace[][] = [];
  for (const row of rows) {
    if (row.group === null) units.push([row]);
    else units[units.length - 1].push(row);
  }
  return units;
}

/** Swaps an item with the neighbouring unit at its own level; null where the rule allows no change. */
export function swapWithNeighbour(rows: readonly RowPlace[], id: string, direction: "up" | "down"): RowPlace[] | null {
  const step = direction === "up" ? -1 : 1;
  const units = topLevelUnits(rows);
  const group = rows.find((row) => row.id === id)?.group ?? null;
  if (group === null) {
    const at = units.findIndex((unit) => unit[0].id === id);
    if (!units[at + step]) return null;
    [units[at], units[at + step]] = [units[at + step], units[at]];
    return units.flat();
  }
  const unit = units.find((candidate) => candidate[0].id === group);
  const children = unit ? unit.slice(1) : [];
  const at = children.findIndex((child) => child.id === id);
  if (!unit || !children[at + step]) return null;
  [children[at], children[at + step]] = [children[at + step], children[at]];
  unit.splice(1, children.length, ...children);
  return units.flat();
}

function insertAfterBlock(rows: RowPlace[], groupId: string, placed: RowPlace): RowPlace[] {
  let last = rows.findIndex((row) => row.id === groupId);
  while (rows[last + 1]?.group === groupId) last++;
  return [...rows.slice(0, last + 1), placed, ...rows.slice(last + 1)];
}

/** Makes the item the last item of a group. */
export function moveIntoGroup(rows: readonly RowPlace[], id: string, groupId: string): RowPlace[] {
  return insertAfterBlock(
    rows.filter((row) => row.id !== id),
    groupId,
    { id, group: groupId },
  );
}

/** Takes the item out of its group and places it just after the group's last row. */
export function moveOutOfGroup(rows: readonly RowPlace[], id: string, groupId: string): RowPlace[] {
  return insertAfterBlock(
    rows.filter((row) => row.id !== id),
    groupId,
    { id, group: null },
  );
}
