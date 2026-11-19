import { useEffect, useState } from "react";
import { copy } from "../../shared/copy";
import { countdownParts } from "../../shared/rules";
import type { StudentClassroomView } from "../../shared/types";
import { api } from "./api";
import { useStreamEvent } from "./stream";

interface Countdown {
  /** The Student's classroom as the server last published it; null until the first answer. */
  classroom: StudentClassroomView | null;
  /** `Hand-in in <d>d <h>h <m>m`, from the server's seconds only (never the device clock). */
  text: string | null;
}

/** The hand-in countdown of the signed-in Student: loaded on mount, refreshed by `classroom-state` events. */
export function useCountdown(classroomId: string | null): Countdown {
  const [classroom, setClassroom] = useState<StudentClassroomView | null>(null);

  useEffect(() => {
    if (!classroomId) return;
    void api.get<StudentClassroomView>("/api/class").then(setClassroom, () => undefined);
  }, [classroomId]);

  useStreamEvent("classroom-state", (event) => {
    if (event.classroomId !== classroomId) return;
    setClassroom((current) => (current ? { ...current, state: event.state, serverNow: event.serverNow, secondsToHandIn: event.secondsToHandIn } : current));
  });

  if (!classroom) return { classroom: null, text: null };
  const { d, h, m } = countdownParts(classroom.secondsToHandIn);
  return { classroom, text: copy.countdown(d, h, m) };
}
