import type { LiveEvent, SessionSnapshot } from '../../shared/wire';

/** What the classroom page hands the 3D scene on every server message. */
export interface SceneInput {
  snapshot: SessionSnapshot;
  /** The live event that produced this snapshot ('snapshot' for the first one on a page). */
  event: LiveEvent;
  /** performance.now() when the message arrived; breakout time left at that moment is snapshot.breakout.remainingSeconds. */
  receivedAt: number;
  /** prefers-reduced-motion: cut, no walks, no rings (stepped seconds on table labels), no model turn. */
  reduced: boolean;
}
