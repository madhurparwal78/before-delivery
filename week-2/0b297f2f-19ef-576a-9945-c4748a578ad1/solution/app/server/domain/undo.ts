// Undo windows (brief: Business rules, Undo windows): 10 seconds after the action, server clock.
const UNDO_WINDOW_MS = 10_000;

export function undoUntil(actionAt: Date): Date {
  return new Date(actionAt.getTime() + UNDO_WINDOW_MS);
}

export function undoOpen(until: Date, now: Date): boolean {
  return now.getTime() < until.getTime();
}

export function undoView(actionId: string, kind: "remove" | "move", until: Date, now: Date) {
  return {
    actionId,
    kind,
    undoUntil: until.toISOString(),
    remainingMs: Math.max(0, until.getTime() - now.getTime()),
  };
}
