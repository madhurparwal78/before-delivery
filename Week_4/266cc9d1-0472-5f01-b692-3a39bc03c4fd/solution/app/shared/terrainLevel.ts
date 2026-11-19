// The terrain-level ordering, shared by the server (which refuses equal or coarser levels) and the
// page (which only sends finer ones): hand-entered (null) ranks below every level.
export function isFinerTerrain(candidate: number | null, stored: number | null): boolean {
  return candidate !== null && (stored === null || candidate > stored);
}
