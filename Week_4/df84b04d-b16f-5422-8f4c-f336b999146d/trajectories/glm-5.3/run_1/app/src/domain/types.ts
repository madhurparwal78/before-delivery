export interface Account {
  id: string;
  email: string;
  name: string;
  hideCompleted: boolean;
}

export interface BulletRow {
  id: string;
  ownerId: string;
  originalId: string | null;
  parentId: string | null;
  position: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: string | null;
  tags: string[];
  mentions: string[];
  revision: number;
  trashedAt: number | null;
  purged: boolean;
  createdAt: number;
}

export interface BulletView {
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  text: string;
  completed: boolean;
  collapsed: boolean;
  date: string | null;
  tags: string[];
  mentions: string[];
  mirrorOf: string | null;
  placeholder: boolean;
  revision: number;
  childCount: number;
}

export interface Person {
  id: string;
  email: string;
  name: string;
}

export interface SharedBranch {
  bulletId: string;
  text: string;
  owner: { name: string };
}

export interface ShareRow {
  id: string;
  bulletId: string;
  ownerId: string;
  email: string;
  token: string;
  status: ShareStatus;
  createdAt: number;
}

export type ShareStatus =
  | 'pending_send'
  | 'sent'
  | 'not_sent'
  | 'accepted'
  | 'lapsed'
  | 'revoked';

export type UndoStepKind =
  | 'new bullet'
  | 'text edit'
  | 'delete'
  | 'move'
  | 'indent'
  | 'outdent'
  | 'completion'
  | 'mirror';

export interface UndoStep {
  id: string;
  accountId: string;
  kind: UndoStepKind;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface ChangeMessage {
  type: 'change';
  seq: number;
  bullets: BulletView[];
  removed: string[];
}

export type LiveMessage =
  | ChangeMessage
  | { type: 'heartbeat'; fanout: 'ok' | 'paused' }
  | { type: 'reload' }
  | { type: 'revoked' };
