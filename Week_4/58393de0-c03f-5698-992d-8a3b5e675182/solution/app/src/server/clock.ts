let offsetMs = 0;

/** Server time: the real clock unless the grading clock set it, then that instant running forward in real time. */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

export function setServerTime(instant: Date | null): void {
  offsetMs = instant ? instant.getTime() - Date.now() : 0;
}
