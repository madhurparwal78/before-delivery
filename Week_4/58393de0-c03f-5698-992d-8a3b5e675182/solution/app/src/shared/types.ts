export type AccountKind = "educator" | "personal" | "student";
export type ProjectKind = "3d" | "circuit" | "blocks";
export type ClassroomState = "draft" | "open" | "in_session" | "handed_in" | "archived";
export type ProjectState = "editing" | "handed_in";
export type ExportFormat = "stl" | "obj" | "svg";
export type ExportUnit = "mm" | "in";

export interface Account {
  id: string;
  kind: AccountKind;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  classroomId: string | null;
  nickname: string | null;
}

export interface SessionView {
  account: Account | null;
  pendingJoin: { classroomName: string } | null;
  /** The newest live-stream event when this answer was made: the page opens its stream after it. */
  streamSequence: number;
}

export interface ClientConfig {
  autosaveMs: number;
  blocksStepMs: number;
  simTickMs: number;
  toastMs: number;
  glancetFadeMs: number;
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

export interface LatestProject {
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
  latestProject: LatestProject | null;
}

export interface ClassroomEducator {
  id: string;
  displayName: string;
  email: string;
  role: "owner" | "assistant";
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
  role: "owner" | "assistant";
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
}

export interface ClassroomExport extends ExportRecord {
  nickname: string;
}

export type ObjectShape = "box" | "cylinder" | "sphere";
export type ObjectKind = ObjectShape | "group";
export type ObjectMode = "solid" | "hole";

export interface DesignObject {
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
  children: DesignObject[];
}

export type Vec3 = [number, number, number];

export interface Workplane {
  origin: Vec3;
  normal: Vec3;
}

export interface Snapshot3d {
  kind: "3d";
  objects: DesignObject[];
  workplane: Workplane;
}

export type CircuitPartType = "battery" | "led" | "resistor" | "switch";

export interface CircuitComponent {
  label: string;
  type: CircuitPartType;
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
  kind: "circuit";
  components: CircuitComponent[];
  wires: CircuitWire[];
}

export type BlockName = "addBox" | "addCylinder" | "addSphere" | "moveX" | "moveY" | "moveZ" | "makeHole" | "repeat";

export interface Block {
  block: BlockName;
  count?: number;
  mm?: number;
  body?: Block[];
}

export interface SnapshotBlocks {
  kind: "blocks";
  program: Block[];
  objects: DesignObject[];
}

export type Snapshot = Snapshot3d | SnapshotCircuit | SnapshotBlocks;

export interface StudentJoinedEvent { classroomId: string; student: { id: string; nickname: string } }
export interface StudentRenamedEvent { classroomId: string; studentId: string; nickname: string }
export interface StudentRemovedEvent { classroomId: string; studentId: string; nickname: string }
export interface ProjectSavedEvent {
  projectId: string;
  ownerId: string;
  classroomId: string | null;
  revision: number;
  savedAt: string;
  kind: ProjectKind;
  name: string;
}
export interface ProjectHandedInEvent { projectId: string; ownerId: string; classroomId: string }
export interface ClassroomStateEvent {
  classroomId: string;
  state: ClassroomState;
  serverNow: string;
  secondsToHandIn: number;
}
export interface AccessEndedEvent { classroomId: string; message: string }

export interface StreamEvents {
  "student-joined": StudentJoinedEvent;
  "student-renamed": StudentRenamedEvent;
  "student-removed": StudentRemovedEvent;
  "project-saved": ProjectSavedEvent;
  "project-handed-in": ProjectHandedInEvent;
  "classroom-state": ClassroomStateEvent;
  "access-ended": AccessEndedEvent;
}

export type StreamEventName = keyof StreamEvents;

export interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  currentRevision?: number;
  retryAfterSeconds?: number;
}
