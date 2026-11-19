// Breakout rules: the split into tables and the deadline clock.

/** Deals learners, already in seat-id order, to tables 1..tables in turn. */
export function dealToTables(learnerIds: string[], tables: number): string[][] {
  const dealt: string[][] = Array.from({ length: tables }, () => []);
  learnerIds.forEach((learnerId, index) => dealt[index % tables]?.push(learnerId));
  return dealt;
}

/** A breakout round splits the room into 2 to `available` tables. */
export function tablesInRange(tables: unknown, available: number): tables is number {
  return typeof tables === 'number' && Number.isInteger(tables) && tables >= 2 && tables <= available;
}

export function remainingSeconds(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** The deadline instant included. */
export function isOver(deadlineMs: number, nowMs: number): boolean {
  return nowMs >= deadlineMs;
}

/** The warning edge included. */
export function isWarning(deadlineMs: number, nowMs: number, warningSeconds: number): boolean {
  return deadlineMs - nowMs <= warningSeconds * 1000;
}
