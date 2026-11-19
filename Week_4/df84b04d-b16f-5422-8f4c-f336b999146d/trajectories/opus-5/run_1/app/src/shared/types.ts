/** The bullet object exchanged by the API, one entry per placement shown in a view. */
export interface Bullet {
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

export interface OutlineView {
  root: Bullet | null;
  ancestors: Bullet[];
  seq: number;
  bullets: Bullet[];
}

export interface MeResponse {
  user: { id: string; email: string; name: string; hideCompleted: boolean };
  shared: Array<{ bulletId: string; text: string; owner: { name: string } }>;
}

export type ShareStatus =
  | 'pending_send'
  | 'sent'
  | 'not_sent'
  | 'accepted'
  | 'lapsed'
  | 'revoked';

export interface ShareRow {
  id: string;
  email: string;
  status: ShareStatus;
  createdAt: string;
}

export interface Suggestion {
  value: string;
  count: number;
}

export interface SearchResult {
  query: string;
  count: number;
  matches: string[];
  context: string[];
}

export type LiveMessage =
  | { type: 'change'; seq: number; bullets: Bullet[]; removed: string[] }
  | { type: 'heartbeat'; fanout: 'ok' | 'paused'; pauseAfterSeconds?: number; heartbeatSeconds?: number }
  | { type: 'reload' }
  | { type: 'revoked' };

export type MoveOp = 'indent' | 'outdent' | 'up' | 'down';

/** The one set of refusal codes the tree can raise. */
export type ConflictCode =
  | 'no_previous_sibling'
  | 'at_top'
  | 'at_first'
  | 'at_last'
  | 'inside_itself'
  | 'too_deep'
  | 'share_root'
  | 'stale_revision'
  | 'nothing_to_undo'
  | 'nothing_to_redo'
  | 'edited_since'
  | 'origin_gone'
  | 'already_invited'
  | 'not_retryable'
  | 'share_closed'
  | 'invitation_lapsed'
  | 'wrong_account'
  | 'email_taken';

/** The bullet text as it is used in names, announcements and slugs. */
export function displayText(bullet: Pick<Bullet, 'text' | 'placeholder'>): string {
  if (bullet.placeholder) return 'This bullet was deleted.';
  const trimmed = bullet.text.trim();
  if (trimmed === '') return 'Untitled';
  return trimmed.slice(0, 60);
}

/** The accessible name of a bullet row: its full stored text. */
export function fullName(bullet: Pick<Bullet, 'text' | 'placeholder'>): string {
  if (bullet.placeholder) return 'This bullet was deleted.';
  return bullet.text.trim() === '' ? 'Untitled' : bullet.text;
}
