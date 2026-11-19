import { isFrozen } from "../shared/rules";
import type { ClassroomState, ClassroomStateEvent, ProjectState } from "../shared/types";

export interface ClassroomTimes {
  joinOpensAt: Date;
  joinClosesAt: Date;
  handInAt: Date;
  archivedAt: Date | null;
}

/** The one place a classroom's state is decided: server time against the stored instants. */
export function classroomState(times: ClassroomTimes, now: Date): ClassroomState {
  if (times.archivedAt) return "archived";
  if (now >= times.handInAt) return "handed_in";
  if (now >= times.joinClosesAt) return "in_session";
  if (now >= times.joinOpensAt) return "open";
  return "draft";
}

/** Whole seconds until hand-in, rounded up so 0 means the classroom is handed in. */
function secondsToHandIn(times: ClassroomTimes, now: Date): number {
  if (times.archivedAt) return 0;
  return Math.max(0, Math.ceil((times.handInAt.getTime() - now.getTime()) / 1000));
}

/** The state of a classroom with the server instant it was read at and the seconds left, always stamped together. */
export function classroomClock(times: ClassroomTimes, now: Date): Pick<ClassroomStateEvent, "state" | "serverNow" | "secondsToHandIn"> {
  return { state: classroomState(times, now), serverNow: now.toISOString(), secondsToHandIn: secondsToHandIn(times, now) };
}

/** A Student project is handed in when its classroom is, or when the Student handed it in. */
export function projectState(handedInAt: Date | null, classroom: ClassroomState | null): ProjectState {
  return handedInAt || (classroom !== null && isFrozen(classroom)) ? "handed_in" : "editing";
}
