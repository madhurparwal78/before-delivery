import { staleRevision } from '../http/errors.js';

/** The one place a save's base revision is judged. */
export function assertBaseRevision(currentRevision: number, baseRevision: number): void {
  if (currentRevision !== baseRevision) throw staleRevision(currentRevision);
}
