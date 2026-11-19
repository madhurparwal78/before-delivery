/** The one place that decides whether a session has ended through idleness. */
export function sessionHasEnded(
  lastActivityAt: Date,
  now: Date,
  idleSeconds: number,
): boolean {
  return now.getTime() - lastActivityAt.getTime() >= idleSeconds * 1000;
}
