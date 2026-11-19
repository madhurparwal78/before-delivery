import type { ClassroomState, ClassroomStateEvent } from "../shared/types";
import { classroomClock, classroomState } from "./classroom-state";
import { serverNow } from "./clock";
import { classroomAudiences, CLASSROOM_COLUMNS, type ClassroomRow } from "./classrooms-store";
import { pool, rows } from "./db";
import { publish } from "./stream-hub";
import { logged } from "./failures";

const TICK_MS = 1000;
const lastStates = new Map<string, ClassroomState>();

export function stateEvent(classroom: ClassroomRow, now = serverNow()): ClassroomStateEvent {
  return { classroomId: classroom.id, ...classroomClock(classroom, now) };
}

/** Tells the classroom's educators and Students its state, now. */
export async function publishClassroomState(classroom: ClassroomRow): Promise<void> {
  const event = stateEvent(classroom);
  lastStates.set(classroom.id, event.state);
  const audience = (await classroomAudiences([classroom.id])).get(classroom.id);
  if (audience) publish([...audience.educators, ...audience.students], "classroom-state", event);
}

/** Re-checks every open classroom against server time; `everyone` sends the state even when it has not changed. */
export async function checkClassroomStates(everyone = false): Promise<void> {
  const classrooms = await rows<ClassroomRow>(pool, `SELECT ${CLASSROOM_COLUMNS} FROM classrooms c WHERE c.archived_at IS NULL`);
  const now = serverNow();
  const due = classrooms.filter((classroom) => {
    const state = classroomState(classroom, now);
    const known = lastStates.get(classroom.id);
    lastStates.set(classroom.id, state);
    return everyone || (known !== undefined && known !== state);
  });
  for (const id of lastStates.keys()) if (!classrooms.some((c) => c.id === id)) lastStates.delete(id);
  const audiences = await classroomAudiences(due.map((c) => c.id));
  for (const classroom of due) {
    const audience = audiences.get(classroom.id);
    if (audience) publish([...audience.educators, ...audience.students], "classroom-state", stateEvent(classroom, now));
  }
}

export function startTicker(): void {
  setInterval(() => void checkClassroomStates().catch(logged("classroom state check", undefined)), TICK_MS);
}

export function forgetClassroomStates(): void {
  lastStates.clear();
}
