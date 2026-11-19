import { isFrozen, isHandedIn } from "../../shared/rules";
import type {
  Classroom, ClassroomStateEvent, LatestProject, ProjectHandedInEvent, ProjectSavedEvent, RosterStudent, StudentJoinedEvent,
} from "../../shared/types";
import { JOIN_CODE_KEY, watchKey } from "./controls";

export type SortOrder = "nickname" | "recent";

const nicknameOrder = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** The roster in the order the select asks for; the newest save first puts Students with no project last. */
export function sortStudents(students: readonly RosterStudent[], order: SortOrder): RosterStudent[] {
  const byNickname = (a: RosterStudent, b: RosterStudent) => nicknameOrder.compare(a.nickname, b.nickname) || a.id.localeCompare(b.id);
  const savedAt = (student: RosterStudent) => (student.latestProject ? Date.parse(student.latestProject.savedAt) : Number.NEGATIVE_INFINITY);
  return [...students].sort(order === "nickname" ? byNickname : (a, b) => savedAt(b) - savedAt(a) || byNickname(a, b));
}

function mapStudent(classroom: Classroom, id: string, change: (student: RosterStudent) => RosterStudent): Classroom {
  return { ...classroom, students: classroom.students.map((student) => (student.id === id ? change(student) : student)) };
}

export function findStudent(classroom: Classroom, id: string): RosterStudent | undefined {
  return classroom.students.find((student) => student.id === id);
}

export function studentJoined(classroom: Classroom, event: StudentJoinedEvent): Classroom {
  if (findStudent(classroom, event.student.id)) return classroom;
  const joined: RosterStudent = { id: event.student.id, nickname: event.student.nickname, handedIn: isHandedIn(classroom.state, null), latestProject: null };
  return { ...classroom, students: [...classroom.students, joined] };
}

export function studentRenamed(classroom: Classroom, studentId: string, nickname: string): Classroom {
  return mapStudent(classroom, studentId, (student) => ({ ...student, nickname }));
}

export function studentRemoved(classroom: Classroom, studentId: string): Classroom {
  return { ...classroom, students: classroom.students.filter((student) => student.id !== studentId) };
}

/** The tile shows the most recently saved project: a newer save of it, or any project saved later than the one shown. */
export function projectSaved(classroom: Classroom, event: ProjectSavedEvent): Classroom {
  return mapStudent(classroom, event.ownerId, (student) => {
    const shown = student.latestProject;
    const same = shown?.id === event.projectId;
    if (shown && same && event.revision <= shown.revision) return student;
    if (shown && !same && Date.parse(event.savedAt) < Date.parse(shown.savedAt)) return student;
    const latest: LatestProject = {
      id: event.projectId, kind: event.kind, name: event.name, revision: event.revision, savedAt: event.savedAt,
      state: shown && same ? shown.state : "editing",
    };
    return { ...student, latestProject: latest, handedIn: isHandedIn(classroom.state, latest) };
  });
}

export function projectHandedIn(classroom: Classroom, event: ProjectHandedInEvent): Classroom {
  return mapStudent(classroom, event.ownerId, (student) => {
    if (student.latestProject?.id !== event.projectId) return student;
    return { ...student, handedIn: true, latestProject: { ...student.latestProject, state: "handed_in" } };
  });
}

export function classroomStateChanged(classroom: Classroom, event: ClassroomStateEvent): Classroom {
  const handedIn = isFrozen(event.state);
  return {
    ...classroom,
    state: event.state,
    serverNow: event.serverNow,
    secondsToHandIn: event.secondsToHandIn,
    students: handedIn ? classroom.students.map((student) => (student.handedIn ? student : { ...student, handedIn: true })) : classroom.students,
  };
}

/** The control that takes focus after a Student's tile leaves: the next tile's Watch button, the last one's when it was last, else the join code. */
export function controlAfterRemoval(sorted: readonly RosterStudent[], removedId: string): string {
  const at = sorted.findIndex((student) => student.id === removedId);
  const next = at >= 0 ? (sorted[at + 1] ?? sorted[at - 1]) : undefined;
  return next ? watchKey(next.id) : JOIN_CODE_KEY;
}
