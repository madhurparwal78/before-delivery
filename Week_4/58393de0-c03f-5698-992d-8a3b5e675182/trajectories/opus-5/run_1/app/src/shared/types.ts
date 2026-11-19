export type AccountKind = 'educator' | 'personal' | 'student';
export type ClassroomState = 'draft' | 'open' | 'in_session' | 'handed_in' | 'archived';
export type ProjectKind = '3d' | 'circuit' | 'blocks';
export type ProjectState = 'editing' | 'handed_in';
export type ExportFormat = 'stl' | 'obj' | 'svg';
export type ExportUnit = 'mm' | 'in';
export type EducatorRole = 'owner' | 'assistant';

export interface Account {
  id: string;
  kind: AccountKind;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  classroomId: string | null;
  nickname: string | null;
}

export interface ProjectSummary {
  id: string;
  kind: ProjectKind;
  name: string;
  revision: number;
  savedAt: string;
  state: ProjectState;
}

export interface RosterStudent {
  id: string;
  nickname: string;
  handedIn: boolean;
  latestProject: ProjectSummary | null;
}

export interface ClassroomEducator {
  id: string;
  displayName: string;
  email: string;
  role: EducatorRole;
}

export interface Classroom {
  id: string;
  name: string;
  timeZone: string;
  state: ClassroomState;
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
  role: EducatorRole;
  students: RosterStudent[];
  educators: ClassroomEducator[];
}

export interface StudentClassroomView {
  id: string;
  name: string;
  timeZone: string;
  state: ClassroomState;
  handInAt: string;
  serverNow: string;
  secondsToHandIn: number;
}

export interface Project {
  id: string;
  kind: ProjectKind;
  name: string;
  ownerId: string;
  classroomId: string | null;
  revision: number;
  savedAt: string;
  state: ProjectState;
}

export interface ExportRecord {
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
  nickname?: string;
}

export interface ClientConfig {
  autosaveMs: number;
  blocksStepMs: number;
  simTickMs: number;
  toastMs: number;
  glancetFadeMs: number;
}

export interface SessionInfo {
  account: Account | null;
  pendingJoin: { classroomName: string } | null;
}

/* ---------- snapshots ---------- */

export type ObjectKind = 'box' | 'cylinder' | 'sphere' | 'group';
export type ObjectMode = 'solid' | 'hole';

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  mode: ObjectMode;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotationZ: number;
  color: string;
  children: SceneObject[];
}

export interface Workplane {
  origin: [number, number, number];
  normal: [number, number, number];
}

export interface Snapshot3d {
  kind: '3d';
  objects: SceneObject[];
  workplane: Workplane;
}

export type ComponentType = 'battery' | 'led' | 'resistor' | 'switch';

export interface CircuitComponent {
  label: string;
  type: ComponentType;
  volts?: number;
  ohms?: number;
  closed?: boolean;
  broken?: boolean;
}

export interface CircuitWire {
  from: string;
  to: string;
}

export interface SnapshotCircuit {
  kind: 'circuit';
  components: CircuitComponent[];
  wires: CircuitWire[];
}

export type BlockName =
  | 'addBox'
  | 'addCylinder'
  | 'addSphere'
  | 'moveX'
  | 'moveY'
  | 'moveZ'
  | 'makeHole'
  | 'repeat';

export interface ProgramBlock {
  block: BlockName;
  count?: number;
  mm?: number;
  body?: ProgramBlock[];
}

export interface SnapshotBlocks {
  kind: 'blocks';
  program: ProgramBlock[];
  objects: SceneObject[];
}

export type Snapshot = Snapshot3d | SnapshotCircuit | SnapshotBlocks;

/* ---------- live stream ---------- */

export interface StreamEvents {
  'student-joined': { classroomId: string; student: { id: string; nickname: string } };
  'student-renamed': { classroomId: string; studentId: string; nickname: string };
  'student-removed': { classroomId: string; studentId: string; nickname: string };
  'project-saved': {
    projectId: string;
    ownerId: string;
    classroomId: string | null;
    revision: number;
    savedAt: string;
    kind: ProjectKind;
    name: string;
  };
  'project-handed-in': { projectId: string; ownerId: string; classroomId: string };
  'classroom-state': {
    classroomId: string;
    state: ClassroomState;
    serverNow: string;
    secondsToHandIn: number;
  };
  'access-ended': { classroomId: string; message: string };
}

export type StreamEventName = keyof StreamEvents;
