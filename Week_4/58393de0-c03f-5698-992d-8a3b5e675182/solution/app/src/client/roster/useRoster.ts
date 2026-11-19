import { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "../../shared/copy";
import type { Classroom, RosterStudent } from "../../shared/types";
import { api, ApiError } from "../lib/api";
import { REMOVED_NOTICE_ID, useNotices } from "../lib/notices";
import { useStatus } from "../lib/status";
import { useStreamEvent, useStreamOpen } from "../lib/stream";
import {
  classroomStateChanged, findStudent, projectHandedIn, projectSaved, studentJoined, studentRemoved, studentRenamed,
} from "./classroomState";

const RELOAD_ATTEMPTS = 3;

type RosterPhase = { kind: "loading" } | { kind: "ready" } | { kind: "failed"; message: string } | { kind: "ended" };

interface RosterHandle {
  phase: RosterPhase;
  classroom: Classroom | null;
  /** Applies a change to the newest classroom and shows it. */
  update: (change: (classroom: Classroom) => Classroom) => void;
  /** Replaces the classroom with the server's answer from a request that returned it. */
  replace: (classroom: Classroom) => void;
  reload: () => Promise<void>;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The classroom page's data: loaded once, then kept current by the one live stream. A reload (on reconnect and when an
 * event cannot be applied) never replaces what an event or an action changed while its request was in flight.
 */
export function useRoster(id: string, onStudentRemoved: (student: RosterStudent, classroom: Classroom) => void): RosterHandle {
  const { announce } = useStatus();
  const { setNotice } = useNotices();
  const [phase, setPhase] = useState<RosterPhase>({ kind: "loading" });
  const [classroom, setClassroom] = useState<Classroom | null>(null);
  const newest = useRef<Classroom | null>(null);
  const changes = useRef(0);
  const removedHandler = useRef(onStudentRemoved);
  removedHandler.current = onStudentRemoved;

  const replace = useCallback((next: Classroom) => {
    newest.current = next;
    changes.current += 1;
    setClassroom(next);
  }, []);

  const update = useCallback((change: (current: Classroom) => Classroom) => {
    if (newest.current) replace(change(newest.current));
  }, [replace]);

  const reload = useCallback(async () => {
    for (let attempt = 0; attempt < RELOAD_ATTEMPTS; attempt += 1) {
      const seen = changes.current;
      let fresh: Classroom;
      try {
        fresh = await api.get<Classroom>(`/api/classrooms/${id}`);
      } catch {
        return;
      }
      const old = newest.current;
      if (changes.current !== seen) continue;
      newest.current = old ? {
        ...fresh,
        students: sameJson(old.students, fresh.students) ? old.students : fresh.students,
        educators: sameJson(old.educators, fresh.educators) ? old.educators : fresh.educators,
      } : fresh;
      setClassroom(newest.current);
      return;
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    newest.current = null;
    setPhase({ kind: "loading" });
    api.get<Classroom>(`/api/classrooms/${id}`).then(
      (loaded) => {
        if (!live) return;
        replace(loaded);
        setPhase({ kind: "ready" });
      },
      (error: unknown) => {
        if (!live) return;
        const message = error instanceof ApiError ? error.message : copy.notFound;
        announce(message);
        setPhase({ kind: "failed", message });
      },
    );
    return () => { live = false; };
  }, [id, replace, announce]);

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") void reload(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [reload]);

  useStreamOpen(() => { void reload(); });

  useStreamEvent("student-joined", (event) => {
    const current = newest.current;
    if (!current || event.classroomId !== current.id || findStudent(current, event.student.id)) return;
    replace(studentJoined(current, event));
    announce(copy.rosterJoined(event.student.nickname));
  });

  useStreamEvent("student-renamed", (event) => {
    const current = newest.current;
    if (!current || event.classroomId !== current.id || findStudent(current, event.studentId)?.nickname === event.nickname) return;
    replace(studentRenamed(current, event.studentId, event.nickname));
  });

  useStreamEvent("student-removed", (event) => {
    const current = newest.current;
    const student = current ? findStudent(current, event.studentId) : undefined;
    if (!current || event.classroomId !== current.id || !student) return;
    const next = studentRemoved(current, event.studentId);
    replace(next);
    removedHandler.current(student, next);
  });

  useStreamEvent("project-saved", (event) => {
    const current = newest.current;
    if (!current || event.classroomId !== current.id) return;
    const student = findStudent(current, event.ownerId);
    if (!student) {
      void reload();
      return;
    }
    const next = projectSaved(current, event);
    if (findStudent(next, event.ownerId) === student) return;
    replace(next);
    announce(copy.rosterSaved(student.nickname, event.revision));
  });

  useStreamEvent("project-handed-in", (event) => {
    const current = newest.current;
    const student = current ? findStudent(current, event.ownerId) : undefined;
    if (!current || event.classroomId !== current.id || !student) return;
    replace(projectHandedIn(current, event));
    announce(copy.rosterHandedIn(student.nickname));
  });

  useStreamEvent("classroom-state", (event) => {
    const current = newest.current;
    if (!current || event.classroomId !== current.id) return;
    replace(classroomStateChanged(current, event));
    void reload();
  });

  useStreamEvent("access-ended", (event) => {
    const current = newest.current;
    if (!current || event.classroomId !== current.id) return;
    setNotice({ id: REMOVED_NOTICE_ID, message: copy.removed(current.name) });
    setPhase({ kind: "ended" });
  });

  return { phase, classroom, update, replace, reload };
}
