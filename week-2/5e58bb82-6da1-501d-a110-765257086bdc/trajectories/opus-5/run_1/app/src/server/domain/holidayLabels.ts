export interface ExistingHoliday {
  id: string;
  label: string;
  label_num: number;
  cells: number[];
}

export interface GroupMatch {
  groupIndex: number;
  /** The existing holiday whose label the group keeps, or null for a new label. */
  existing: ExistingHoliday | null;
}

export interface LabelMatching {
  matches: GroupMatch[];
  /** Existing holidays left unmatched, which become Closed. */
  closed: ExistingHoliday[];
}

/**
 * Matches this pass's qualifying groups to the mission's Open and Queued holidays
 * so that labels stay stable across recomputes. A group may take a label only
 * when it shares a cell with that holiday.
 */
export function matchHolidayLabels(
  groups: { cells: number[] }[],
  existing: ExistingHoliday[],
): LabelMatching {
  const shared = groups.map((group) => {
    const cells = new Set(group.cells);
    return new Map(
      existing.map((holiday) => [
        holiday.id,
        holiday.cells.reduce((total, cell) => total + (cells.has(cell) ? 1 : 0), 0),
      ]),
    );
  });

  const bestFor = groups.map((_group, groupIndex) => {
    let best: ExistingHoliday | null = null;
    let bestShared = 0;
    for (const holiday of existing) {
      const count = shared[groupIndex]!.get(holiday.id) ?? 0;
      if (count === 0) continue;
      if (
        count > bestShared ||
        (count === bestShared && best !== null && holiday.label_num < best.label_num)
      ) {
        best = holiday;
        bestShared = count;
      }
    }
    return best;
  });

  const lowestCell = (groupIndex: number): number =>
    groups[groupIndex]!.cells.reduce((lowest, cell) => Math.min(lowest, cell), Infinity);

  const winners = new Map<string, number>();
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const best = bestFor[groupIndex];
    if (!best) continue;
    const current = winners.get(best.id);
    if (current === undefined) {
      winners.set(best.id, groupIndex);
      continue;
    }
    const challengerShared = shared[groupIndex]!.get(best.id) ?? 0;
    const holderShared = shared[current]!.get(best.id) ?? 0;
    const better =
      challengerShared > holderShared ||
      (challengerShared === holderShared &&
        (groups[groupIndex]!.cells.length > groups[current]!.cells.length ||
          (groups[groupIndex]!.cells.length === groups[current]!.cells.length &&
            lowestCell(groupIndex) < lowestCell(current))));
    if (better) winners.set(best.id, groupIndex);
  }

  const takenBy = new Map<number, ExistingHoliday>();
  for (const [holidayId, groupIndex] of winners) {
    const holiday = existing.find((item) => item.id === holidayId);
    if (holiday) takenBy.set(groupIndex, holiday);
  }

  return {
    matches: groups.map((_group, groupIndex) => ({
      groupIndex,
      existing: takenBy.get(groupIndex) ?? null,
    })),
    closed: existing.filter((holiday) => !winners.has(holiday.id)),
  };
}
