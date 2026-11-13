import type { LetterBody, LetterClass } from '../../shared/types.js';
import { copy, say } from '../copy.js';
import { sealLetterBody } from '../crypto/seal.js';
import { announce } from '../ui/live.js';
import { api, ApiFailure, Offline } from './api.js';
import { idbAll, idbDelete, idbPut, STORES } from './idb.js';
import { keyFor, rememberPublicKey } from './keys.js';
import {
  emit,
  letterById,
  letterFromRecord,
  peerName,
  putLetter,
  state,
  type LocalLetter,
} from './store.js';

export interface OutboxAttachment {
  blobId: string;
  kind: 'image' | 'file';
  sealed: ArrayBuffer;
  stored: boolean;
}

export interface OutboxEntry {
  id: string;
  order: number;
  conversationId: string;
  peerId: string;
  letterClass: LetterClass;
  body: LetterBody;
  attachment: OutboxAttachment | null;
  attempts: number;
  /** An upload that answered storage_unavailable waits for Retry upload. */
  uploadFailed: boolean;
}

let nextOrder = 0;
let running = false;
let retryTimer: number | null = null;

export async function primeOutbox(): Promise<void> {
  const entries = await idbAll<OutboxEntry>(STORES.outbox);
  nextOrder = entries.reduce((highest, entry) => Math.max(highest, entry.order), 0) + 1;
}

export async function enqueue(entry: Omit<OutboxEntry, 'order' | 'attempts' | 'uploadFailed'>): Promise<void> {
  const stored: OutboxEntry = { ...entry, order: nextOrder, attempts: 0, uploadFailed: false };
  nextOrder += 1;
  await idbPut(STORES.outbox, stored);
  kick();
}

export function kick(): void {
  if (retryTimer !== null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (!running) void drain();
}

/** Letters paused behind the key-change stub are resealed to the new key and posted. */
export async function resumeFor(conversationId: string): Promise<void> {
  const entries = await idbAll<OutboxEntry>(STORES.outbox);
  for (const entry of entries.filter((candidate) => candidate.conversationId === conversationId)) {
    const letter = letterById(entry.id);
    if (letter !== null && letter.paused) {
      await putLetter({ ...letter, paused: false });
    }
  }
  kick();
}

export async function retryUpload(letterId: string): Promise<void> {
  const entry = await idbGetEntry(letterId);
  if (entry === null) return;
  await idbPut(STORES.outbox, { ...entry, uploadFailed: false, attempts: 0 });
  const letter = letterById(letterId);
  if (letter !== null) {
    await putLetter({ ...letter, state: 'sending', failure: null, uploading: true });
  }
  kick();
}

async function idbGetEntry(letterId: string): Promise<OutboxEntry | null> {
  const entries = await idbAll<OutboxEntry>(STORES.outbox);
  return entries.find((entry) => entry.id === letterId) ?? null;
}

async function drain(): Promise<void> {
  running = true;
  try {
    for (;;) {
      const entries = (await idbAll<OutboxEntry>(STORES.outbox)).sort((a, b) => a.order - b.order);
      const next = entries.find((entry) => {
        if (entry.uploadFailed) return false;
        const letter = letterById(entry.id);
        return letter === null || !letter.paused;
      });
      if (next === undefined) return;
      const outcome = await attempt(next);
      if (outcome === 'retry') {
        const delay = Math.min(
          state.config.timers.retry_cap_ms,
          state.config.timers.retry_base_ms * 2 ** next.attempts,
        );
        await idbPut(STORES.outbox, { ...next, attempts: next.attempts + 1 });
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          kick();
        }, delay);
        return;
      }
    }
  } finally {
    running = false;
  }
}

type Outcome = 'done' | 'retry' | 'paused' | 'refused' | 'upload_failed';

async function markRefused(entry: OutboxEntry, text: string): Promise<void> {
  await idbDelete(STORES.outbox, entry.id);
  const letter = letterById(entry.id);
  if (letter === null) return;
  await putLetter({ ...letter, refused: text, state: 'failed', uploading: false });
}

async function attempt(original: OutboxEntry): Promise<Outcome> {
  let entry = original;
  let conversation = state.conversations.get(entry.conversationId) ?? null;
  if (conversation === null) {
    try {
      conversation = await api.conversation(entry.conversationId);
      state.conversations.set(conversation.id, conversation);
    } catch (error) {
      if (error instanceof Offline) return 'retry';
      await markRefused(entry, copy.letterRefused);
      return 'refused';
    }
  }

  if (entry.attachment !== null && !entry.attachment.stored) {
    const sealed = new Uint8Array(entry.attachment.sealed);
    try {
      await api.declareBlob(entry.attachment.blobId, entry.attachment.kind, sealed.length);
      await api.uploadBlob(entry.attachment.blobId, sealed);
    } catch (error) {
      if (error instanceof Offline) return 'retry';
      if (error instanceof ApiFailure && error.status >= 500 && error.code !== 'storage_unavailable') {
        return 'retry';
      }
      await failUpload(entry);
      return 'upload_failed';
    }
    entry = { ...entry, attachment: { ...entry.attachment, stored: true } };
    await idbPut(STORES.outbox, entry);
    announce(copy.uploadFinished);
  }

  await rememberPublicKey(conversation.peer.key_id, conversation.peer.public_key);
  const key = await keyFor(conversation.peer.id, conversation.peer.key_id, state.me?.key_id ?? '');
  if (key === null) return 'retry';
  const sealed = await sealLetterBody(key, entry.body);

  try {
    const record = await api.postLetter({
      id: entry.id,
      conversation_id: entry.conversationId,
      class: entry.letterClass,
      recipient_key_id: conversation.peer.key_id,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      ...(entry.attachment === null ? {} : { attachment_id: entry.attachment.blobId }),
    });
    await idbDelete(STORES.outbox, entry.id);
    const letter = letterFromRecord(record, 'sent', entry.body, letterById(entry.id));
    await putLetter(letter);
    if (entry.letterClass === 'letter') {
      announce(say.posted(peerName(conversation)));
      emit('posted', letter);
    }
    return 'done';
  } catch (error) {
    if (error instanceof Offline) return 'retry';
    if (!(error instanceof ApiFailure)) throw error;
    if (error.status >= 500) {
      if (error.code === 'storage_unavailable') {
        await failUpload(entry);
        return 'upload_failed';
      }
      return 'retry';
    }
    if (error.code === 'seal_change_unaccepted' || error.code === 'recipient_key_changed') {
      const letter = letterById(entry.id);
      if (letter !== null) await putLetter({ ...letter, paused: true, state: 'sending' });
      try {
        state.conversations.set(entry.conversationId, await api.conversation(entry.conversationId));
        emit('conversations');
      } catch {
        // The next conversation frame brings the new key.
      }
      return 'paused';
    }
    await markRefused(entry, copy.letterRefused);
    return 'refused';
  }
}

async function failUpload(entry: OutboxEntry): Promise<void> {
  await idbPut(STORES.outbox, { ...entry, uploadFailed: true });
  const letter = letterById(entry.id);
  if (letter !== null) {
    await putLetter({
      ...letter,
      state: 'failed',
      failure: 'upload',
      uploading: false,
    });
  }
  announce(copy.uploadFailed);
}

export function pendingLetter(
  id: string,
  conversationId: string,
  body: LetterBody,
  letterClass: LetterClass,
  uploading: boolean,
): LocalLetter {
  return {
    id,
    conversationId,
    seq: null,
    direction: 'sent',
    letterClass,
    state: 'sending',
    failure: null,
    heldAt: null,
    deliveredAt: null,
    readAt: null,
    returnedAt: null,
    retractedAt: null,
    canRetract: false,
    body,
    attachmentId: null,
    deletedForMe: false,
    uploading,
    refused: null,
    paused: false,
    createdAt: Date.now(),
  };
}
