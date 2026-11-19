import { useEffect } from 'preact/hooks';

export interface StreamEvents {
  onStudentJoined?: (classroomId: string, student: { id: string; nickname: string }) => void;
  onStudentRenamed?: (classroomId: string, studentId: string, nickname: string) => void;
  onStudentRemoved?: (classroomId: string, studentId: string, nickname: string) => void;
  onProjectSaved?: (ev: { projectId: string; ownerId: string; classroomId: string | null; revision: number; savedAt: string; kind: string; name: string }) => void;
  onProjectHandedIn?: (ev: { projectId: string; ownerId: string; classroomId: string | null }) => void;
  onClassroomState?: (ev: { classroomId: string; state: string; serverNow: string; secondsToHandIn: number }) => void;
  onAccessEnded?: (ev: { classroomId: string; message: string }) => void;
}

export interface StreamHandle {
  close(): void;
}

export function openStream(handlers: StreamEvents): StreamHandle {
  const source = new EventSource('/api/stream');
  const bind = <T>(name: string, fn: ((data: T) => void) | undefined) => {
    if (!fn) return;
    source.addEventListener(name, (ev) => {
      try { fn(JSON.parse((ev as MessageEvent).data)); } catch { /* ignore malformed */ }
    });
  };
  bind('student-joined', (d: { classroomId: string; student: { id: string; nickname: string } }) => handlers.onStudentJoined?.(d.classroomId, d.student));
  bind('student-renamed', (d: { classroomId: string; studentId: string; nickname: string }) => handlers.onStudentRenamed?.(d.classroomId, d.studentId, d.nickname));
  bind('student-removed', (d: { classroomId: string; studentId: string; nickname: string }) => handlers.onStudentRemoved?.(d.classroomId, d.studentId, d.nickname));
  bind('project-saved', handlers.onProjectSaved);
  bind('project-handed-in', handlers.onProjectHandedIn);
  bind('classroom-state', handlers.onClassroomState);
  bind('access-ended', handlers.onAccessEnded);
  return {
    close() {
      source.close();
    },
  };
}

export function useLiveStream(handlers: StreamEvents): void {
  useEffect(() => {
    const handle = openStream(handlers);
    return () => handle.close();
  }, []);
}
