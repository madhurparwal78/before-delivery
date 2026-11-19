export type AccountKind = 'educator' | 'personal' | 'student';

export interface Account {
  id: string;
  kind: AccountKind;
  displayName: string | null;
  email: string | null;
  emailVerified: boolean;
  classroomId: string | null;
  nickname: string | null;
}

export type ClassroomStateName = 'draft' | 'open' | 'in_session' | 'handed_in' | 'archived';

export interface StudentSummary {
  id: string;
  nickname: string;
  handedIn: boolean;
  latestProject: {
    id: string;
    kind: ProjectKind;
    name: string;
    revision: number;
    savedAt: string;
    state: 'editing' | 'handed_in';
  } | null;
}

export interface EducatorSummary {
  id: string;
  displayName: string;
  email: string;
  role: 'owner' | 'assistant';
}

export interface Classroom {
  id: string;
  name: string;
  timeZone: string;
  state: ClassroomStateName;
  joinCode: string;
  joinOpensLocal: string;
  joinClosesLocal: string;
  handInLocal: string;
  joinOpensAt: string;
  joinClosesAt: string;
  handInAt: string;
  serverNow: string;
  secondsToHandIn: number;
  ownerId: string;
  role: 'owner' | 'assistant';
  students: StudentSummary[];
  educators: EducatorSummary[];
}

export interface StudentClassroomView {
  id: string;
  name: string;
  timeZone: string;
  state: ClassroomStateName;
  handInAt: string;
  serverNow: string;
  secondsToHandIn: number;
}

export type ProjectKind = '3d' | 'circuit' | 'blocks';

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  ownerId: string;
  classroomId: string | null;
  revision: number;
  savedAt: string;
  state: 'editing' | 'handed_in';
}

export type ExportFormat = 'stl' | 'obj' | 'svg';
export type ExportUnit = 'mm' | 'in';

export interface Export {
  id: string;
  projectId: string | null;
  ownerId: string;
  fileName: string;
  format: ExportFormat;
  unit: ExportUnit;
  bytes: number;
  triangleCount: number | null;
  bbox: { x: number; y: number; z: number } | null;
  createdAt: string;
  downloadUrl: string;
}

export interface ClassroomExport extends Export {
  nickname: string;
}

export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
  currentRevision?: number;
  retryAfterSeconds?: number;
}

export interface AppConfig {
  autosaveMs: number;
  blocksStepMs: number;
  simTickMs: number;
  toastMs: number;
  glancetFadeMs: number;
}
