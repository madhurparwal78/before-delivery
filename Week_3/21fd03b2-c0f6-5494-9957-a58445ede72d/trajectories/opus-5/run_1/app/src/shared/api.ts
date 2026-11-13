import type { ActivityAction } from './activity.js';
import type { AssetKind, ModelUnit } from './uploads.js';
import type { SceneDocument } from './scene.js';
import type { InviteRevokeReason, InviteRole, InviteStatus, SceneStatus, WorkspaceRole } from './states.js';

export interface ApiError {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
}

export interface MemberRow {
  userId: string;
  displayName: string;
  email: string;
  role: WorkspaceRole;
}

export interface InviteRow {
  id: string;
  email: string;
  role: InviteRole;
  status: InviteStatus;
  expiresAt: string;
}

export interface MeResponse {
  user: UserSummary;
  workspaces: WorkspaceSummary[];
  lastWorkspaceId: string | null;
}

export interface WorkspaceResponse {
  workspace: WorkspaceSummary;
  members: MemberRow[];
  invites: InviteRow[];
}

export interface ProjectRow {
  id: string;
  name: string;
  sceneCount: number;
  assetCount: number;
  updatedAt: string;
}

export interface SceneRow {
  id: string;
  name: string;
  status: SceneStatus;
  revision: number;
}

export interface AssetRow {
  id: string;
  name: string;
  kind: AssetKind;
  bytes: number;
  sha256: string;
  unit: ModelUnit | null;
  scaleToMetres: number | null;
  extentMetres: number | null;
  createdAt: string;
}

export interface LabRecord {
  token: string;
  url: string;
  bundleHash: string;
  publishedAt: string;
  checkpointId: string;
  exposed: string[];
}

export interface SceneRecord {
  id: string;
  projectId: string;
  name: string;
  status: SceneStatus;
  revision: number;
  stateHash: string;
  lab: LabRecord | null;
}

export interface SceneResponse {
  scene: SceneRecord;
  document: SceneDocument;
}

export interface PatchResponse {
  revision: number;
  stateHash: string;
}

export interface VerifyResponse {
  step: number;
  stateHash: string;
}

export interface LockHolder {
  userId: string;
  displayName: string;
}

export interface LockRow {
  objectId: string;
  holder: LockHolder;
  fence: number;
  expiresAt: string;
}

export interface PresencePerson {
  userId: string;
  displayName: string;
  cursor: [number, number, number] | null;
  selected: string | null;
}

export interface PresenceResponse {
  people: PresencePerson[];
  locks: LockRow[];
}

export interface CheckpointRow {
  id: string;
  label: string;
  revision: number;
  stateHash: string;
  documentSha256: string;
  createdAt: string;
}

export interface ActivityEvent {
  id: string;
  at: string;
  actor: { userId: string; displayName: string };
  action: ActivityAction;
  targetName: string;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  nextBefore: string | null;
}

export interface ShareLinkRow {
  id: string;
  token: string;
  url: string;
  expiresAt: string;
}

export interface StatusResponse {
  locks: 'ok' | 'down';
  storage: 'ok' | 'down';
  mail: 'ok' | 'down';
}

export interface ExposedParameter {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  value: number;
}

export interface LabBundle {
  assets: { assetId: string; kind: AssetKind; scaleToMetres: number | null; sha256: string }[];
  bundleVersion: 1;
  checkpointId: string;
  document: SceneDocument;
  exposed: string[];
  solver: { iterations: 4; step: '1/120' };
}

export interface LabResponse {
  lab: {
    sceneName: string;
    bundleHash: string;
    publishedAt: string;
    exposed: ExposedParameter[];
  };
  bundle: LabBundle;
}

export interface ViewProjectResponse {
  project: { name: string };
  scenes: { id: string; name: string; stateHash: string }[];
}

export interface ViewSceneResponse {
  scene: SceneRecord;
  document: SceneDocument;
  assets: AssetRow[];
}

export type { InviteRevokeReason };
