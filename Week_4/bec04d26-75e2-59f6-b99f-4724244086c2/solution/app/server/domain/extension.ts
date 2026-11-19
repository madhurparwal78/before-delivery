/** An extension is granted at the deadline instant itself and refused from one millisecond later. */
export function extensionOpen(dueAtMs: number, nowMs: number): boolean {
  return nowMs <= dueAtMs;
}
