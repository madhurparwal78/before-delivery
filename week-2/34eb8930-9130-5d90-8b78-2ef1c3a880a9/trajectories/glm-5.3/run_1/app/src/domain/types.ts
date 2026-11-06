import type { Op, BlockStyle, MarkType } from './ot.js';
export type { BlockStyle };

export type DomainRole = 'owner' | 'editor' | 'commenter' | 'viewer';
export type Mode = 'editing' | 'suggesting' | 'viewing';
export type ShareStatus = 'active' | 'expired';
export type SuggestionKind = 'insert' | 'delete' | 'replace';
export type SuggestionStatus = 'open' | 'accepted' | 'rejected';
export type CommentStatus = 'open' | 'resolved' | 'reopened';
export type SaveState = 'saved' | 'saving' | 'failed';
export type PresenceState = 'active' | 'idle';
export type Span = { at: number; length: number };
export type AccessEndReason = 'expired' | 'removed' | 'deleted';

export type BlockRecord = { style: BlockStyle; at: number; length: number };
export type MarkRecord = { type: MarkType; at: number; length: number; href?: string };

/** One operation in the server-ordered history; at is its position in the text before the ops of this revision apply. */
export type HistoryOp = Op;

export type RevisionRecord = { revision: number; authorId: string; mode: Mode; ops: HistoryOp[] };

export const SUGGESTION_KINDS: SuggestionKind[] = ['insert', 'delete', 'replace'];
export const MODES: Mode[] = ['editing', 'suggesting', 'viewing'];

export function id(len = 17): string {
  let out = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The single role permission table. A role not listed for an action is refused. */
export const ROLE_PERMISSIONS = {
  open: ['owner', 'editor', 'commenter', 'viewer'],
  suggest: ['owner', 'editor', 'commenter'],
  comment: ['owner', 'editor', 'commenter'],
  edit: ['owner', 'editor'],
  decide: ['owner', 'editor'],
  manage: ['owner'],
} as const satisfies Record<string, readonly DomainRole[]>;

export type PermissionAction = keyof typeof ROLE_PERMISSIONS;

export function roleCan(role: DomainRole, action: PermissionAction): boolean {
  return (ROLE_PERMISSIONS[action] as readonly DomainRole[]).includes(role);
}

/** Modes a role allows; disabled radios come from the same table. */
export function allowedModes(role: DomainRole): Mode[] {
  if (role === 'viewer') return ['viewing'];
  if (role === 'commenter') return ['suggesting', 'viewing'];
  return ['editing', 'suggesting', 'viewing'];
}

/** The mode stored on a role change: a downgrade clamps the mode to what the new role allows. */
export function clampMode(role: DomainRole, mode: Mode): Mode {
  const allowed = allowedModes(role);
  if (allowed.includes(mode)) return mode;
  if (role === 'viewer') return 'viewing';
  if (role === 'commenter') return 'suggesting';
  return 'editing';
}

/** First open of a proposal. */
export function initialMode(role: DomainRole): Mode {
  if (role === 'viewer') return 'viewing';
  if (role === 'commenter') return 'suggesting';
  return 'editing';
}

/** Words are runs of non-whitespace characters. */
export function countWords(text: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i += 1) {
    const ws = /\s/.test(text[i]!);
    if (!ws && !inWord) n += 1;
    inWord = !ws;
  }
  return n;
}

export function clipSpan(text: string, span: Span): Span {
  const at = Math.max(0, Math.min(span.at, text.length));
  const length = Math.max(0, Math.min(span.length, text.length - at));
  return { at, length };
}
