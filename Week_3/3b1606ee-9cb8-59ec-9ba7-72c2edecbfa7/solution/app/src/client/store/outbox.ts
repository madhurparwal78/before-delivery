import type { BlobKind, Conversation, Letter } from '../../shared/types';
import { conversationKey } from '../crypto/identity';
import { sealBody, sealFile } from '../crypto/sealing';
import { uuid } from '../lib/format';
import type { Attachment, LetterBody, LocalLetter, ProfileKeyBody } from '../types';
import { api, ApiFailure, NetworkFailure, uploadBlob } from './api';
import { refreshConversation } from './conversations';
import { profileKeyDelivered } from './owed';
import { applyServerLetter } from './letters';
import { forget, db, persist, privateKeyFor } from './session';
import { announce, getState } from './state';

/** A photo or file chosen in the composer, already prepared (a photo is re-encoded, a file is as-is). */
export interface PreparedAttachment {
  kind: 'image' | 'file';
  bytes: Uint8Array<ArrayBuffer>;
  name: string;
  type: string;
  width?: number;
  height?: number;
  thumb?: string;
}

const UPLOAD_FAILED = "Couldn't upload. Your letter wasn't sent.";
const prepared = new Map<string, PreparedAttachment>();
let lastWrite = 0;
let failures = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;

/** A strictly increasing write order, even when the page clock stands still. */
function nextWrite(): number {
  lastWrite = Math.max(Date.now(), lastWrite + 1);
  return lastWrite;
}

function blank(conversationId: string, letterClass: 'letter' | 'control'): LocalLetter {
  return {
    id: uuid(),
    conversationId,
    direction: 'sent',
    letterClass,
    body: null,
    draft: null,
    profileKey: null,
    writtenAt: nextWrite(),
    phase: 'queued',
    sealed: null,
    blobId: null,
    seq: null,
    state: null,
    failure: null,
    heldAt: null,
    deliveredAt: null,
    readAt: null,
    returnedAt: null,
    retractedAt: null,
    canRetract: false,
  };
}

/** Writes a letter into the outbox and returns its id at once; sealing, uploading and posting follow. */
export function writeLetter(conversationId: string, text: string, attachment: PreparedAttachment | null): string {
  const letter = blank(conversationId, 'letter');
  if (attachment) {
    letter.phase = 'uploading';
    letter.blobId = uuid();
    letter.draft = {
      kind: attachment.kind,
      text,
      name: attachment.name,
      type: attachment.type,
      size: attachment.bytes.length,
      width: attachment.width,
      height: attachment.height,
      thumb: attachment.thumb,
    };
    prepared.set(letter.id, attachment);
  } else {
    letter.body = { v: 1, kind: 'text', text };
  }
  persist(letter);
  kickOutbox();
  return letter.id;
}

/** Queues a control letter carrying the profile key; it is never shown. It is stored before it is posted. */
export async function writeProfileKey(conversationId: string, profileKey: string): Promise<void> {
  const queued = Object.values(getState().letters).some((letter) => letter.letterClass === 'control' && letter.conversationId === conversationId);
  if (queued) return;
  const letter = blank(conversationId, 'control');
  letter.profileKey = profileKey;
  await persist(letter);
  kickOutbox();
}

function outboxLetters(): LocalLetter[] {
  return Object.values(getState().letters)
    .filter((letter) => letter.direction === 'sent' && (letter.phase === 'queued' || letter.phase === 'uploading'))
    .sort((a, b) => a.writtenAt - b.writtenAt);
}

function scheduleRetry(): void {
  const timers = getState().config!.timers;
  failures += 1;
  const delay = Math.min(timers.retry_base_ms * 2 ** (failures - 1), timers.retry_cap_ms);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void processOutbox();
  }, delay);
}

/** A new letter goes out at once unless the outbox is waiting out a retry delay. */
function kickOutbox(): void {
  if (retryTimer === null) void processOutbox();
}

/** The browser came back online or the socket reconnected: retry now. */
export function resumeOutbox(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  void processOutbox();
}

export function retryUpload(letterId: string): void {
  const letter = getState().letters[letterId];
  if (!letter || letter.phase !== 'upload_failed') return;
  persist({ ...letter, phase: 'uploading' });
  kickOutbox();
}

async function processOutbox(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const paused = new Set<string>();
      for (const letter of outboxLetters()) {
        if (paused.has(letter.conversationId)) continue;
        const outcome = await attempt(letter.id);
        if (outcome === 'retry') {
          scheduleRetry();
          return;
        }
        if (outcome === 'paused') paused.add(letter.conversationId);
        if (outcome === 'done') failures = 0;
      }
    } while (again);
  } finally {
    running = false;
  }
}

type Outcome = 'done' | 'paused' | 'retry';

const current = (id: string): LocalLetter | undefined => getState().letters[id];

async function attempt(id: string): Promise<Outcome> {
  let letter = current(id);
  if (!letter) return 'done';
  const conversation = getState().conversations[letter.conversationId];
  if (!conversation) return 'paused';
  if (letter.phase === 'uploading') {
    const uploaded = await upload(letter);
    if (uploaded !== 'uploaded') return uploaded;
    letter = current(id);
    if (!letter) return 'done';
  }
  if (conversation.peer.seal === 'changed') return 'paused';
  return post(letter, conversation);
}

async function upload(letter: LocalLetter): Promise<Outcome | 'uploaded'> {
  const failUpload = (): Outcome => {
    persist({ ...letter, phase: 'upload_failed' });
    announce(UPLOAD_FAILED);
    return 'done';
  };
  try {
    let current = letter;
    if (!current.body) {
      const source = prepared.get(letter.id);
      if (!source) return failUpload();
      const sealed = await sealFile(source.bytes);
      const attachment: Attachment = {
        blob_id: letter.blobId!,
        key: sealed.key,
        iv: sealed.iv,
        digest: sealed.digest,
        size: source.bytes.length,
        name: source.name,
        type: source.type,
        ...(source.width ? { width: source.width, height: source.height, thumb: source.thumb } : {}),
      };
      const text = letter.draft?.text ?? '';
      const body: LetterBody = source.kind === 'image' ? { v: 1, kind: 'image', text, attachment } : { v: 1, kind: 'file', text: '', attachment };
      current = { ...letter, body };
      await db().setFile(letter.id, new Blob([sealed.sealed]));
      persist(current);
      prepared.delete(letter.id);
    }
    const sealedBytes = await db().getFile(letter.id);
    if (!sealedBytes) return failUpload();
    const bytes = new Uint8Array(await sealedBytes.arrayBuffer());
    const kind: BlobKind = current.draft?.kind === 'image' ? 'image' : 'file';
    await api('POST', '/api/blobs', { id: current.blobId, kind, size: bytes.length });
    try {
      await uploadBlob(current.blobId!, bytes);
    } catch (error) {
      if (!(error instanceof ApiFailure && error.code === 'already_stored')) throw error;
    }
    persist({ ...current, phase: 'queued' });
    announce('Upload finished.');
    return 'uploaded';
  } catch (error) {
    if (error instanceof NetworkFailure || (error instanceof ApiFailure && error.status >= 500 && error.code !== 'storage_unavailable')) return 'retry';
    return failUpload();
  }
}

async function sealFor(letter: LocalLetter, conversation: Conversation): Promise<NonNullable<LocalLetter['sealed']>> {
  const me = getState().me!;
  const privateKey = privateKeyFor(me.key_id);
  if (!privateKey) throw new Error('this browser holds no identity key for the account');
  const key = await conversationKey(privateKey, me.key_id, conversation.peer.public_key, [me.id, conversation.peer.id]);
  const body: LetterBody | ProfileKeyBody =
    letter.letterClass === 'control' ? { v: 1, kind: 'profile', profile_key: letter.profileKey! } : letter.body!;
  const sealed = await sealBody(key, body);
  return { ...sealed, recipientKeyId: conversation.peer.key_id };
}

async function post(letter: LocalLetter, conversation: Conversation, reseal = false): Promise<Outcome> {
  let sealed = letter.sealed;
  if (!sealed || sealed.recipientKeyId !== conversation.peer.key_id || reseal) {
    sealed = await sealFor(letter, conversation);
    letter = { ...letter, sealed };
    persist(letter);
  }
  try {
    const stored = await api<Letter>('POST', '/api/letters', {
      id: letter.id,
      conversation_id: letter.conversationId,
      class: letter.letterClass,
      recipient_key_id: sealed.recipientKeyId,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      ...(letter.blobId ? { attachment_id: letter.blobId } : {}),
    });
    posted(letter, stored);
    return 'done';
  } catch (error) {
    if (error instanceof NetworkFailure) return 'retry';
    if (!(error instanceof ApiFailure)) throw error;
    if (error.code === 'seal_change_unaccepted' || error.code === 'recipient_key_changed') {
      const fresh = await refreshConversation(letter.conversationId);
      if (!fresh || fresh.peer.seal === 'changed' || reseal) return 'paused';
      return post(letter, fresh, true);
    }
    if (error.code === 'storage_unavailable' && letter.blobId) {
      persist({ ...current(letter.id)!, phase: 'upload_failed' });
      announce(UPLOAD_FAILED);
      return 'done';
    }
    if (error.status >= 500) return 'retry';
    if (letter.letterClass === 'control') forget(letter.id);
    else persist({ ...current(letter.id)!, phase: 'refused' });
    return 'done';
  }
}

/** The exchange accepted the letter: it is held, and its postmark is struck. */
function posted(letter: LocalLetter, stored: Letter): void {
  if (letter.letterClass === 'control') {
    forget(letter.id);
    const peer = getState().conversations[letter.conversationId]?.peer;
    if (peer) void profileKeyDelivered(peer.id);
  } else applyServerLetter(stored, true);
}
