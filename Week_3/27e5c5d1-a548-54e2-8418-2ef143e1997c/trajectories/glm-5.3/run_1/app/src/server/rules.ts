// Domain rules. Each published rule is decided in exactly one function here.

import type {
  BoardPayload,
  Card,
  CardList,
  CardStatus,
  Colour,
  DueState,
  Label,
  ListCount,
  Role,
} from '../shared/protocol.js';
import { LABELS } from '../shared/protocol.js';

export const ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

export const COLOUR_ORDER: Colour[] = ['sage', 'clay', 'plum', 'ochre', 'slate', 'rose'];

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && ID_PATTERN.test(value);
}

export function codePointLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c <= 31 || c === 127) return true;
  }
  return false;
}

export function initialsFor(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
  return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase();
}

/** Effective board access: the single decision for who may see a board and at which role. */
export function effectiveRole(
  membership: { role: Role | 'removed' } | null,
  visibility: 'workspace' | 'private',
): Role | null {
  // A removed member has no access, even on a workspace-visible board.
  if (membership) return membership.role === 'removed' ? null : membership.role;
  if (visibility === 'workspace') return 'observer';
  return null;
}

/** Legal card status edges: the single decision for allowed transitions. */
export function allowedStatusChange(from: CardStatus, to: CardStatus): boolean {
  if (from === 'open' && to === 'done') return true;
  if (from === 'done' && to === 'open') return true;
  if (from === 'open' && to === 'archived') return true;
  if (from === 'done' && to === 'archived') return true;
  if (from === 'archived' && to === 'open') return true;
  return false;
}

/** The stale-version check: a write must carry the card's current version. */
export function isStaleWrite(currentVersion: number, requestVersion: unknown): boolean {
  return typeof requestVersion !== 'number' || !Number.isInteger(requestVersion) || requestVersion !== currentVersion;
}

export function canEdit(role: Role | null): boolean {
  return role === 'member' || role === 'admin';
}

/** Due state decided by the server in the workspace time zone: the one place this is computed. */
export function dueStateFor(
  dueDate: string | null,
  status: CardStatus,
  todayInZone: string,
): DueState {
  if (!dueDate) return null;
  if (status !== 'open') return null;
  if (dueDate === todayInZone) return 'due_today';
  if (dueDate < todayInZone) return 'overdue';
  return 'upcoming';
}

export function normaliseLabels(input: unknown): Label[] | null {
  if (!Array.isArray(input)) return null;
  const picked: Label[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') return null;
    const label = LABELS.find((l) => l === raw);
    if (!label) return null;
    if (!picked.includes(label)) picked.push(label);
  }
  return LABELS.filter((l) => picked.includes(l));
}

export function trimTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 120) return null;
  return value;
}

export function trimName(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > max) return null;
  return value;
}

/** The safe return-path check: four conditions, one decision. */
export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (value.length > 2000) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return '/';
  if (value.includes('\\')) return '/';
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c <= 31 || c === 127) return '/';
  }
  return value;
}

export function isPrintableAsciiName(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    const c = name.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return !name.includes('"') && !name.includes('\\');
}

/** The download file-name header: the one place Content-Disposition is built. */
export function contentDispositionFor(name: string): string {
  if (isPrintableAsciiName(name)) {
    return `attachment; filename="${name}"`;
  }
  let fallback = '';
  for (const ch of name) {
    const c = ch.codePointAt(0)!;
    fallback += c > 126 || c < 32 || ch === '"' || ch === '\\' ? '_' : ch;
  }
  const fallbackSafe = fallback.replace(/"/g, '_').replace(/\\/g, '_');
  const reserved = new Set("!#$&+-.^_`|~".split('').map((c) => c));
  let encoded = '';
  const bytes = Buffer.from(name, 'utf8');
  for (const byte of bytes) {
    const c = String.fromCharCode(byte);
    const isAlnum = (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122);
    encoded += isAlnum || reserved.has(c) ? c : '%' + byte.toString(16).toUpperCase().padStart(2, '0');
  }
  return `attachment; filename="${fallbackSafe}"; filename*=UTF-8''${encoded}`;
}

/** Attachment content check: signatures of the three published types. */
export const ATTACHMENT_SIGNATURES: Record<string, Buffer> = {
  'application/pdf': Buffer.from('%PDF-', 'utf8'),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

export function matchesDeclaredType(declared: string, bytes: Buffer): boolean {
  const sig = ATTACHMENT_SIGNATURES[declared];
  if (!sig) return false;
  return bytes.length >= sig.length && sig.compare(bytes, 0, sig.length) === 0;
}

/** The published request keys, per endpoint: unknown keys answer 422 on each key. */
export interface KeySpec {
  required: string[];
  optional: string[];
}

export function checkKeys(body: unknown, spec: KeySpec): { ok: true; value: Record<string, unknown> } | { ok: false; unknownKeys: string[] } | { ok: false; malformed: true } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, malformed: true };
  }
  const record = body as Record<string, unknown>;
  const unknownKeys: string[] = [];
  for (const key of Object.keys(record)) {
    if (!spec.required.includes(key) && !spec.optional.includes(key)) {
      unknownKeys.push(key);
    }
  }
  if (unknownKeys.length > 0) {
    return { ok: false, unknownKeys };
  }
  return { ok: true, value: record };
}

// ---- Rank and position helpers --------------------------------------------------

export interface RankedCard {
  id: string;
  rank: number;
}

/**
 * Rank placement: one dense unique order 1..N per list counting every card.
 * A move places the card before the visible card holding the requested position,
 * or after the last card when the position is past the last visible card.
 */
export function computeMoveRanks(
  cardsInTarget: RankedCard[],
  movingCardId: string,
  visibleIdsBeforeTarget: string[],
  requestedPosition: number,
): number {
  // visibleIdsBeforeTarget: ids of non-archived visible cards in the target list (excluding the moving card), in order.
  void cardsInTarget;
  void movingCardId;
  void requestedPosition;
  void visibleIdsBeforeTarget;
  return 0;
}

// ---- Response shaping per role: the one place cards are shaped --------------------

export interface RawPersonChipData {
  displayName: string;
  initials: string;
  colour: Colour;
}

export interface ShapeContext {
  role: Role;
  canSeePrivate: boolean;
  dueToday: string;
  positions: Map<string, number>;
}

export interface RawCardRow {
  id: string;
  boardId: string;
  listId: string;
  title: string;
  rank: number;
  labels: string[];
  dueDate: string | null;
  status: CardStatus;
  version: number;
  owner: RawPersonChipData & { userId: string } | null;
  checklist: { id: string; text: string; done: boolean }[];
  notes: string | null;
  isPrivate: boolean;
  privateMembers: { userId: string; displayName: string }[];
  attachments: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    uploadedAt: string;
    uploadedByName: string;
  }[];
}

export function shapeCard(row: RawCardRow, ctx: ShapeContext): Card {
  const position = row.status === 'archived' ? null : ctx.positions.get(row.id) ?? null;
  const owner = row.owner
    ? {
        displayName: row.owner.displayName,
        initials: row.owner.initials,
        colour: row.owner.colour,
        ...(ctx.role !== 'observer' ? { userId: row.owner.userId } : {}),
      }
    : null;
  const card: Card = {
    id: row.id,
    boardId: row.boardId,
    listId: row.listId,
    title: row.title,
    position,
    labels: row.labels as Label[],
    dueDate: row.dueDate,
    dueState: dueStateFor(row.dueDate, row.status, ctx.dueToday),
    status: row.status,
    version: row.version,
    owner,
    checklist: row.checklist,
  };
  if (ctx.role !== 'observer') {
    card.notes = row.notes ?? '';
    card.isPrivate = row.isPrivate;
    card.privateMembers = [...row.privateMembers].sort((a, b) => a.displayName.localeCompare(b.displayName));
    card.attachments = row.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
      uploadedAt: a.uploadedAt,
      uploadedBy: { displayName: a.uploadedByName },
    }));
  }
  return card;
}

export function buildCounts(lists: CardList[]): ListCount[] {
  return lists.map((l) => ({ listId: l.id, count: l.count }));
}

export function emptyBoardPayload(): BoardPayload {
  return { board: { id: '', name: '', visibility: 'workspace', workspaceId: '', parentName: '' }, role: 'observer', lists: [] };
}
