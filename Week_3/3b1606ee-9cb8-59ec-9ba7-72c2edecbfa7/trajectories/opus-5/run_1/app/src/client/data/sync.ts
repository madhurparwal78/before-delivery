import { base64urlDecode, base64urlEncode } from '../../shared/scheme.js';
import type { ConversationRecord, LetterBody, LetterRecord } from '../../shared/types.js';
import { say } from '../copy.js';
import { formatTime } from '../format.js';
import { openLetterBody } from '../crypto/seal.js';
import { announce, raiseToast, setCollecting } from '../ui/live.js';
import { api, ApiFailure, Offline } from './api.js';
import { idbGet, idbPut, STORES } from './idb.js';
import { keyFor, rememberPublicKey, requireIdentity, savePeerProfileKey } from './keys.js';
import { openPeerProfile } from './profiles.js';
import { enqueue } from './outbox.js';
import {
  conversationOf,
  emit,
  letterById,
  letterFromRecord,
  lettersOf,
  peerName,
  putConversation,
  putLetter,
  state,
} from './store.js';

const PROFILE_KEY_SENT = 'profile_key_sent';

async function profileKeySentTo(): Promise<string[]> {
  return (await idbGet<string[]>(STORES.prefs, PROFILE_KEY_SENT)) ?? [];
}

async function rememberProfileKeySent(accountId: string): Promise<void> {
  const sent = await profileKeySentTo();
  if (!sent.includes(accountId)) await idbPut(STORES.prefs, [...sent, accountId], PROFILE_KEY_SENT);
}

/** The profile key travels only inside control letters. */
export async function sendProfileKey(conversation: ConversationRecord): Promise<void> {
  const me = requireIdentity();
  const body: LetterBody = {
    v: 1,
    kind: 'profile',
    profile_key: base64urlEncode(me.profileKey),
  };
  await enqueue({
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    peerId: conversation.peer.id,
    letterClass: 'control',
    body,
    attachment: null,
  });
  await rememberProfileKeySent(conversation.peer.id);
}

export async function sendProfileKeyToAllContacts(): Promise<void> {
  await idbPut(STORES.prefs, [], PROFILE_KEY_SENT);
  for (const conversation of state.conversations.values()) {
    if (conversation.status === 'accepted') await sendProfileKey(conversation);
  }
}

export async function refreshConversations(): Promise<void> {
  const [accepted, requests] = await Promise.all([
    api.conversations('accepted'),
    api.conversations('request'),
  ]);
  const seen = new Set<string>();
  for (const record of [...accepted.conversations, ...requests.conversations]) {
    seen.add(record.id);
    await absorbConversation(record);
  }
  for (const id of [...state.conversations.keys()]) {
    if (!seen.has(id)) state.conversations.delete(id);
  }
  emit('conversations');
}

export async function absorbConversation(record: ConversationRecord): Promise<void> {
  putConversation(record);
  await rememberPublicKey(record.peer.key_id, record.peer.public_key);
  await openPeerProfile(record);
}

async function openIncoming(record: LetterRecord): Promise<void> {
  let conversation = conversationOf(record.conversation_id);
  if (conversation === null) {
    conversation = await api.conversation(record.conversation_id);
    await absorbConversation(conversation);
  }
  let body: LetterBody | null = null;
  if (record.iv !== null && record.ciphertext !== null) {
    const key = await keyFor(record.sender_id, record.sender_key_id, record.recipient_key_id);
    if (key !== null) {
      try {
        body = await openLetterBody(key, { iv: record.iv, ciphertext: record.ciphertext });
      } catch {
        body = null;
      }
    }
  }

  if (body !== null && body.kind === 'profile') {
    await savePeerProfileKey(record.sender_id, base64urlDecode(body.profile_key));
    await openPeerProfile(conversation);
    const sent = await profileKeySentTo();
    if (!sent.includes(conversation.peer.id) && conversation.status === 'accepted') {
      await sendProfileKey(conversation);
    }
  }

  const existing = letterById(record.id);
  await putLetter(letterFromRecord(record, 'received', body, existing));
}

function toastText(conversation: ConversationRecord, body: LetterBody | null): string {
  const name = peerName(conversation);
  switch (state.me?.settings.preview) {
    case 'name_only':
      return name;
    case 'none':
      return 'New letter';
    default:
      return say.toastNameAndLetter(name, previewFor(body));
  }
}

function previewFor(body: LetterBody | null): string {
  if (body === null) return '';
  if (body.kind === 'image') return body.text === '' ? 'Photo' : body.text.split('\n')[0] ?? '';
  if (body.kind === 'file') return 'File';
  if (body.kind === 'text') return body.text.split('\n')[0] ?? '';
  return '';
}

function muted(conversation: ConversationRecord): boolean {
  if (conversation.muted_until === null) return false;
  if (conversation.muted_until === 'always') return true;
  return Date.parse(conversation.muted_until) > Date.now();
}

/** Collects everything the exchange held, in order, then acknowledges it. */
export async function collectInbox(): Promise<void> {
  let held;
  try {
    held = await api.inbox();
  } catch (error) {
    if (error instanceof Offline) return;
    throw error;
  }
  if (held.letters.length === 0) {
    setCollecting(0);
    return;
  }
  setCollecting(held.letters.length);

  let highest = 0;
  const arrived: LetterRecord[] = [];
  for (const record of held.letters) {
    await openIncoming(record);
    highest = Math.max(highest, record.seq);
    arrived.push(record);
  }
  await api.ack(highest);
  await refreshConversations();
  setCollecting(0);

  for (const record of arrived) {
    const conversation = conversationOf(record.conversation_id);
    if (conversation === null || record.class !== 'letter') continue;
    const letter = letterById(record.id);
    if (conversation.id === state.openConversationId) {
      announce(say.newLetter(peerName(conversation)));
      emit('letter', letter);
      continue;
    }
    if (conversation.status !== 'accepted' || muted(conversation)) continue;
    raiseToast({
      text: toastText(conversation, letter?.body ?? null),
      conversationId: conversation.id,
    });
  }
  await markOpenConversationRead();
}

export async function handleLetterFrame(record: LetterRecord): Promise<void> {
  const me = state.me;
  if (me === null) return;
  if (record.recipient_id === me.id && record.ciphertext !== null) {
    await collectInbox();
    return;
  }
  const existing = letterById(record.id);
  if (existing === null) {
    if (record.recipient_id === me.id) return;
    await putLetter(letterFromRecord(record, 'sent', null, null));
    return;
  }
  await putLetter(letterFromRecord(record, existing.direction, existing.body, existing));
  if (record.sender_id === me.id && record.class === 'letter') {
    announceStateChange(record, existing.state);
  }
}

function announceStateChange(record: LetterRecord, before: string): void {
  const conversation = conversationOf(record.conversation_id);
  if (conversation === null || record.state === before) return;
  const name = peerName(conversation);
  if (record.state === 'delivered' && record.delivered_at !== null) {
    announce(say.delivered(name, formatTime(record.delivered_at)));
  }
  if (record.state === 'read' && record.read_at !== null) {
    announce(say.read(name, formatTime(record.read_at)));
  }
  if (record.failure === 'returned') announce(say.returned(name));
}

/** Letters are marked read up to the newest one while the conversation is open. */
export async function markOpenConversationRead(): Promise<void> {
  const conversationId = state.openConversationId;
  if (conversationId === null || document.visibilityState !== 'visible') return;
  const conversation = conversationOf(conversationId);
  if (conversation === null) return;
  const letters = lettersOf(conversationId).filter((letter) => letter.seq !== null);
  const highest = letters.reduce((top, letter) => Math.max(top, letter.seq ?? 0), 0);
  if (highest === 0) return;
  try {
    putConversation(await api.read(conversationId, highest));
  } catch (error) {
    if (error instanceof Offline) return;
    if (!(error instanceof ApiFailure)) throw error;
  }
}

/** Brings a conversation's stored letters up to date with the exchange. */
export async function loadConversationLetters(conversationId: string): Promise<void> {
  const { letters } = await api.letters(conversationId);
  const me = state.me;
  if (me === null) return;
  for (const record of letters) {
    if (record.class !== 'letter') continue;
    const existing = letterById(record.id);
    if (existing === null && record.recipient_id === me.id && record.ciphertext !== null) {
      await openIncoming(record);
      continue;
    }
    if (existing === null) continue;
    await putLetter(letterFromRecord(record, existing.direction, existing.body, existing));
  }
}

export async function syncNow(): Promise<void> {
  await refreshConversations();
  await collectInbox();
}
