import { el } from './dom.js';
import * as api from './api.js';
import { ApiFailure } from './api.js';
import type { Suggestion, Thread, TextFile, FileSummary, Label, Member, Invite, Role, CitationReport } from '../shared/types.js';
import { navigate, requestFocus, rerender } from './app-state.js';
import { projectUrl } from './router.js';
import { formatDateTime } from './layout.js';
import { dialogFrame, wrapTab, mentionState, updateMention, buildMentionList, mentionKeydown } from './dialogs.js';

/** Shared mutable project state, defined in app.ts and imported here. */
export interface ProjectHandle {
  pid: string;
  role: Role | null;
  openFile: TextFile | null;
  draft: string;
  lastLoadedRevision: number;
  suggestions: Suggestion[];
  threads: Thread[];
  members: Member[];
  invites: Invite[];
  setInvites: (invites: Invite[]) => void;
  historyEntries: import('../shared/types.js').LedgerEntry[];
  labels: Label[];
  citationReport: CitationReport | null;
  files: FileSummary[];
  exportResult: { export: import('../shared/types.js').ExportShape } | null;
  exportBusy: boolean;
  shareLink: import('../shared/types.js').ShareLink | null;
  focusedCard: string | null;
  pendingCard: string | null;
  lastActionSeq: number;
  uploadFile: File | null;
  uploadFolder: string;
  dialog: DialogState | null;
  message: (m: string) => void;
  storageMessage: (m: string) => void;
  roleChanged: (role: Role) => void;
  refresh: () => Promise<void>;
  openFileByPath: (path: string) => Promise<void>;
}

export type DialogState =
  | { kind: 'suggest'; from: number; to: number }
  | { kind: 'comment'; from: number; to: number }
  | { kind: 'new-file' }
  | { kind: 'upload' }
  | { kind: 'delete-confirm'; fid: string; path: string }
  | { kind: 'stale'; current: TextFile; unsaved: string }
  | { kind: 'history' }
  | { kind: 'people' }
  | { kind: 'citations' }
  | { kind: 'submission' }
  | { kind: 'restore-confirm'; label: Label }
  | { kind: 'files-dialog' }
  | { kind: 'new-project' }
  | { kind: 'profile' };

export function isFailure(e: unknown): e is ApiFailure {
  return e instanceof ApiFailure;
}

export function roleChangeCopy(role: Role): string {
  return `Your role on this project is now ${role}.`;
}

export function forbiddenCopy(role: Role): string {
  return `You can no longer do that. Your role on this project is now ${role}.`;
}

export async function resolveSuggestion(
  h: ProjectHandle, s: Suggestion, outcome: 'accept' | 'reject',
): Promise<void> {
  h.pendingCard = s.id;
  h.lastActionSeq = Date.now();
  h.message(outcome === 'accept' ? 'Accepting suggestion…' : 'Rejecting suggestion…');
  rerender();
  const sentAt = Date.now();
  try {
    const res = outcome === 'accept'
      ? await api.postAccept(h.pid, s.id)
      : await api.postReject(h.pid, s.id);
    const acceptedFile = outcome === 'accept' ? (res as { file?: TextFile }).file : undefined;
    h.lastActionSeq = Date.now();
    h.pendingCard = null;
    const idx = h.suggestions.findIndex((x) => x.id === s.id);
    if (idx >= 0) h.suggestions[idx] = res.suggestion;
    if (acceptedFile && h.openFile?.id === acceptedFile.id) {
      h.openFile = { ...h.openFile, revision: acceptedFile.revision, content: acceptedFile.content };
      if (!draftChanged(h)) h.draft = acceptedFile.content;
      h.lastLoadedRevision = acceptedFile.revision;
    }
    h.message(res.openSuggestions === 1
      ? `${outcome === 'accept' ? 'Suggestion accepted' : 'Suggestion rejected'}, 1 open remains`
      : `${outcome === 'accept' ? 'Suggestion accepted' : 'Suggestion rejected'}, ${res.openSuggestions} open remain`);
    focusAfterResolve(h, s.id);
    rerender();
  } catch (e) {
    h.lastActionSeq = Date.now();
    h.pendingCard = null;
    if (isFailure(e)) {
      if (e.shape.status === 409 && e.shape.suggestion) {
        const winner = e.shape.suggestion;
        const idx = h.suggestions.findIndex((x) => x.id === s.id);
        if (idx >= 0) h.suggestions[idx] = winner;
        if (winner.status === 'orphaned') {
          h.message('This suggestion lost its passage and can no longer be applied');
        } else {
          h.message(`Already ${winner.status} by ${winner.resolvedBy?.displayName ?? ''}`);
        }
        focusAfterResolve(h, s.id);
        rerender();
        return;
      }
      if (e.shape.status === 403) {
        const role = await rereadRole(h);
        h.message(forbiddenCopy(role));
        if (h.dialog && (h.dialog.kind === 'suggest' || h.dialog.kind === 'comment' || h.dialog.kind === 'new-file' || h.dialog.kind === 'upload')) {
          h.dialog = null;
          requestFocus('source-box');
        }
        rerender();
        return;
      }
      h.message('Something went wrong. Try again.');
      rerender();
      return;
    }
    h.message('Not applied. Your connection dropped; try again.');
    requestFocus(`resolve-${s.id}-${outcome}`);
    rerender();
    void sentAt;
  }
}

function draftChanged(h: ProjectHandle): boolean {
  return h.openFile !== null && h.draft !== h.openFile.content;
}

async function rereadRole(h: ProjectHandle): Promise<Role> {
  const res = await api.getProject(h.pid);
  h.role = res.project.role;
  return res.project.role;
}

function focusAfterResolve(h: ProjectHandle, resolvedId: string): void {
  const openCards = openCardIds(h);
  const idx = openCards.indexOf(resolvedId);
  const nextId = openCards[idx + 1] ?? openCards[idx - 1] ?? null;
  h.focusedCard = nextId;
  if (nextId) requestFocus(`card-${nextId}`);
  else requestFocus('source-box');
}

export function openCardIds(h: ProjectHandle): string[] {
  const openFileId = h.openFile?.id;
  if (!openFileId) return [];
  const items = [
    ...h.suggestions.filter((s) => s.fileId === openFileId && s.status === 'open'),
    ...h.threads.filter((t) => t.fileId === openFileId && t.status === 'open' && !t.orphaned),
  ];
  items.sort((a, b) => (a.from ?? 0) - (b.from ?? 0));
  return items.map((i) => i.id);
}

export async function postReply(h: ProjectHandle, t: Thread, body: string): Promise<void> {
  if (body.trim().length === 0) return;
  h.message('Sending…');
  rerender();
  h.lastActionSeq = Date.now();
  try {
    await api.postComment(h.pid, t.id, body);
    h.lastActionSeq = Date.now();
    const res = await api.getReview(h.pid);
    h.suggestions = res.suggestions;
    h.threads = res.threads;
    h.message('Reply posted');
    requestFocus(`card-${t.id}`);
    rerender();
  } catch (e) {
    h.lastActionSeq = Date.now();
    if (isFailure(e)) {
      if (e.shape.status === 409) h.message('This thread is already resolved');
      else if (e.shape.status === 403) {
        const role = await rereadRole(h);
        h.message(forbiddenCopy(role));
      } else h.message('Something went wrong. Try again.');
    } else h.message('Something went wrong. Try again.');
    rerender();
  }
}

export async function resolveThread(h: ProjectHandle, t: Thread): Promise<void> {
  h.message('Sending…');
  rerender();
  h.lastActionSeq = Date.now();
  try {
    const res = await api.postResolve(h.pid, t.id);
    h.lastActionSeq = Date.now();
    const idx = h.threads.findIndex((x) => x.id === t.id);
    if (idx >= 0) h.threads[idx] = res.thread;
    h.message('Thread resolved');
    focusAfterResolve(h, t.id);
    rerender();
  } catch (e) {
    h.lastActionSeq = Date.now();
    if (isFailure(e)) {
      if (e.shape.status === 409) h.message('This thread is already resolved');
      else if (e.shape.status === 403) {
        const role = await rereadRole(h);
        h.message(forbiddenCopy(role));
      } else h.message('Something went wrong. Try again.');
    }
    rerender();
  }
}
