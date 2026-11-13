// The one answer-window rule: a receipt counts only at or before the deadline, measured on the server's clock.
export const windowOpen = (deadlineAt: number, at: number): boolean => at <= deadlineAt;

export function measureWindow(opensAt: number, deadlineAt: number, receivedAt: number): { latencyMs: number; remainingMs: number } {
  return { latencyMs: receivedAt - opensAt, remainingMs: deadlineAt - receivedAt };
}
