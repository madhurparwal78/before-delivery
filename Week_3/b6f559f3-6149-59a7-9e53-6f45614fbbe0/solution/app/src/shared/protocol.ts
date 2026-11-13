/** The wire contract between the editor, the embed and the server beyond what the brief's tables pin. */
import type { Patch } from './document';
import type { AssetInfo, LockInfo, ProjectSummary, SceneDocument } from './types';

export interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface Person {
  id: string;
  name: string;
}

export interface MeResponse {
  user: SessionUser;
  workspaces: { id: string; name: string; role: 'Owner' | 'Member' }[];
}

/** `GET /api/projects/:id`: the brief's fields plus the live state an editor starts from. */
export interface ProjectResponse {
  project: ProjectSummary;
  document: SceneDocument;
  assets: AssetInfo[];
  locks: LockInfo[];
  seq: number;
  undoDepth: number;
  redoDepth: number;
}

/** `POST /api/projects/:id/ops`: the brief's fields plus the patch the change produced. */
export interface OpsResponse {
  opId: string;
  seq: number;
  undoDepth: number;
  redoDepth: number;
  ids: Record<string, string>;
  patch: Patch;
}

export type UndoResponse = Omit<OpsResponse, 'ids'>;

export type ClientMessage = { type: 'subscribe'; projectId: string } | { type: 'embed'; projectId: string };

export type ServerMessage =
  | { type: 'hello'; seq: number; people: Person[]; locks: LockInfo[] }
  /** Everyone who has the project open, the receiver included. */
  | { type: 'presence'; people: Person[] }
  /** A committed change, undo or redo. `opId` lets the sender skip its own echo. */
  | { type: 'patch'; seq: number; opId: string; by: Person; patch: Patch }
  | { type: 'lock'; lock: LockInfo }
  | { type: 'unlock'; layerId: string }
  | { type: 'version'; number: number }
  /** Membership changed: refetch the members list. */
  | { type: 'members' };

export const WS_PATH = '/ws';
