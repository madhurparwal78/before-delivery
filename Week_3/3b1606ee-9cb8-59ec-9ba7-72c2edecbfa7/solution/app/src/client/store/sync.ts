import type { Conversation, KeyEntry, Letter, ServerFrame } from '../../shared/types';
import { conversationKey } from '../crypto/identity';
import { openBody } from '../crypto/sealing';
import { firstLine } from '../lib/format';
import type { LetterBody, LocalLetter, ProfileKeyBody } from '../types';
import { api, ApiFailure, hooks } from './api';
import { applyConversation, isMuted, nameOf, refreshConversation, refreshConversations } from './conversations';
import { applyServerLetter } from './letters';
import { resumeOutbox } from './outbox';
import { payOwedKeys, receiveProfileKey } from './profiles';
import { persist, privateKeyFor } from './session';
import { announce, getState, setState, type Toast } from './state';

const MIN_UPDATING_MS = 1000;
const RECONNECT_MS = 1000;
const MAX_TOASTS = 3;

/** True from the moment the browser loses its connection until the catch-up after it returns is done. */
let away = false;
let socket: WebSocket | null = null;
let socketOpen = false;
let lostTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let toastSerial = 0;
const peerKeys = new Map<string, KeyEntry[]>();

const connected = (): boolean => navigator.onLine && socketOpen;

/** The Connecting bar appears this long after the browser goes offline or the socket closes. */
function connectionLost(): void {
  away = true;
  if (lostTimer !== null || getState().connecting) return;
  lostTimer = setTimeout(() => {
    lostTimer = null;
    if (!connected()) setState({ connecting: true });
  }, getState().config!.timers.connecting_delay_ms);
}

function connectionRestored(): void {
  if (lostTimer !== null) clearTimeout(lostTimer);
  lostTimer = null;
  if (getState().connecting) setState({ connecting: false });
}

function openSocket(): void {
  const mine = ++generation;
  socket?.close();
  const next = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  socket = next;
  next.onopen = () => {
    if (mine !== generation) return;
    socketOpen = true;
    if (navigator.onLine) connectionRestored();
    void afterReconnect();
  };
  next.onmessage = (event) => void handleFrame(JSON.parse(String(event.data)) as ServerFrame);
  next.onclose = () => {
    if (mine !== generation) return;
    socketOpen = false;
    connectionLost();
    if (reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (getState().auth === 'signed_in') openSocket();
      }, RECONNECT_MS);
    }
  };
}

function closeSocket(): void {
  generation += 1;
  socket?.close();
  socket = null;
  socketOpen = false;
}

async function afterReconnect(): Promise<void> {
  try {
    await refreshConversations();
    await payOwedKeys();
    await collect(true);
    await Promise.all(Object.values(getState().conversations).map((conversation) => loadLetters(conversation.id)));
    const health = await api<{ status: string }>('GET', '/api/health');
    hooks.onStorage(health.status === 'ok');
    away = false;
  } catch {
    // a failed refresh is retried by the next reconnect or push
  }
  resumeOutbox();
}

export function startSync(): void {
  window.addEventListener('offline', connectionLost);
  window.addEventListener('online', () => {
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socketOpen) {
      connectionRestored();
      void afterReconnect();
    } else openSocket();
  });
  if (!navigator.onLine) connectionLost();
  openSocket();
}

export function stopSync(): void {
  closeSocket();
}

async function handleFrame(frame: ServerFrame): Promise<void> {
  if (frame.type === 'signed_out') {
    hooks.onUnauthenticated();
  } else if (frame.type === 'conversation') {
    applyConversation(frame.conversation);
  } else if (frame.type === 'keys') {
    peerKeys.delete(frame.account_id);
  } else {
    const me = getState().me!;
    if (frame.letter.recipient_id === me.id && frame.letter.ciphertext !== null) void collect(away);
    else applyServerLetter(frame.letter, true);
  }
}

async function senderKey(accountId: string, keyId: string): Promise<string | null> {
  let keys = peerKeys.get(accountId);
  let found = keys?.find((key) => key.key_id === keyId);
  if (!found) {
    keys = (await api<{ keys: KeyEntry[] }>('GET', `/api/accounts/${accountId}/keys`)).keys;
    peerKeys.set(accountId, keys);
    found = keys.find((key) => key.key_id === keyId);
  }
  return found?.public_key ?? null;
}

async function openHeld(held: Letter): Promise<LetterBody | ProfileKeyBody | null> {
  const privateKey = privateKeyFor(held.recipient_key_id);
  const senderPublic = await senderKey(held.sender_id, held.sender_key_id);
  if (!privateKey || !senderPublic || !held.iv || !held.ciphertext) return null;
  try {
    const key = await conversationKey(privateKey, held.recipient_key_id, senderPublic, [held.sender_id, held.recipient_id]);
    return await openBody<LetterBody | ProfileKeyBody>(key, { iv: held.iv, ciphertext: held.ciphertext });
  } catch {
    return null;
  }
}

function toastText(letter: LocalLetter, conversation: Conversation): string {
  const preview = getState().me!.settings.preview;
  const body = letter.body;
  const line = body ? (body.kind === 'text' ? firstLine(body.text) : body.kind === 'image' ? firstLine(body.text) || 'Photo' : 'File') : '';
  if (preview === 'name_and_letter') return `${nameOf(conversation)}: ${line}`;
  return preview === 'name_only' ? nameOf(conversation) : 'New letter';
}

function conversationOpen(conversationId: string): boolean {
  return getState().route === `/letters/${conversationId}` && document.visibilityState === 'visible';
}

function raiseToast(conversationId: string, text: string): void {
  toastSerial += 1;
  const toast: Toast = { id: toastSerial, conversationId, text };
  setState((current) => ({ toasts: [...current.toasts, toast].slice(-MAX_TOASTS) }));
  setTimeout(() => dismissToast(toast.id), getState().config!.timers.toast_ms);
}

export function dismissToast(id: number): void {
  setState((current) => ({ toasts: current.toasts.filter((toast) => toast.id !== id) }));
}

async function receive(held: Letter, live: boolean): Promise<void> {
  const body = await openHeld(held);
  if (!body) return;
  if (held.class === 'control') {
    if (body.kind === 'profile') await receiveProfileKey(held.sender_id, body.profile_key);
    return;
  }
  if (body.kind === 'profile') return;
  let conversation: Conversation | null | undefined = getState().conversations[held.conversation_id];
  if (!conversation) conversation = await refreshConversation(held.conversation_id);
  const letter: LocalLetter = {
    id: held.id,
    conversationId: held.conversation_id,
    direction: 'received',
    letterClass: 'letter',
    body,
    draft: null,
    profileKey: null,
    writtenAt: Date.parse(held.held_at),
    phase: 'received',
    sealed: null,
    blobId: null,
    seq: held.seq,
    state: held.state,
    failure: null,
    heldAt: held.held_at,
    deliveredAt: held.delivered_at,
    readAt: held.read_at,
    returnedAt: null,
    retractedAt: null,
    canRetract: false,
  };
  await persist(letter);
  if (!conversation) return;
  if (conversationOpen(held.conversation_id)) announce(`New letter from ${nameOf(conversation)}.`);
  else if (live && conversation.status === 'accepted' && !isMuted(conversation)) raiseToast(conversation.id, toastText(letter, conversation));
}

let collecting = false;
let collectAgain = false;
let collectLive = false;
let barShownAt: ReturnType<typeof setTimeout> | null = null;
let barMinimumDone = true;
let barPending = false;

function showUpdating(count: number): void {
  setState({ updating: count });
  barMinimumDone = false;
  barPending = true;
  if (barShownAt !== null) clearTimeout(barShownAt);
  barShownAt = setTimeout(() => {
    barMinimumDone = true;
    hideUpdating();
  }, MIN_UPDATING_MS);
}

function hideUpdating(): void {
  if (barPending || !barMinimumDone) return;
  setState({ updating: null });
}

/**
 * Fetches every letter held for this person, opens them in order, and acknowledges through the highest seq. Letters
 * pushed live raise toasts; those held while this browser was away only fill the Updating bar and the badges.
 */
async function collect(withBar: boolean): Promise<void> {
  if (collecting) {
    collectAgain = true;
    collectLive ||= !withBar;
    return;
  }
  collecting = true;
  collectLive = !withBar;
  try {
    do {
      collectAgain = false;
      const held = (await api<{ letters: Letter[] }>('GET', '/api/inbox')).letters;
      if (held.length === 0) continue;
      if (withBar) showUpdating(held.length);
      const live = collectLive;
      collectLive = false;
      for (const letter of held) await receive(letter, live);
      await api('POST', '/api/inbox/ack', { through_seq: Math.max(...held.map((letter) => letter.seq)) });
      await Promise.all([...new Set(held.filter((letter) => letter.class === 'letter').map((letter) => letter.conversation_id))].map((id) => loadLetters(id)));
      barPending = false;
      hideUpdating();
    } while (collectAgain);
  } catch {
    // the next push or reconnect collects again
  } finally {
    barPending = false;
    hideUpdating();
    collecting = false;
  }
}

/** The exchange's current record of this conversation's letters, folded into the opened ones. */
export async function loadLetters(conversationId: string): Promise<boolean> {
  try {
    const { letters } = await api<{ letters: Letter[] }>('GET', `/api/conversations/${conversationId}/letters?limit=200`);
    for (const letter of letters) applyServerLetter(letter, false);
    return true;
  } catch (error) {
    if (error instanceof ApiFailure && error.status === 404) return false;
    return false;
  }
}

const readThrough = new Map<string, number>();

/** The open conversation's letters are read up to the newest one. */
export async function markRead(conversationId: string): Promise<void> {
  const conversation = getState().conversations[conversationId];
  if (!conversation) return;
  const seqs = Object.values(getState().letters)
    .filter((letter) => letter.conversationId === conversationId && letter.direction === 'received' && letter.seq !== null && letter.state !== 'sent')
    .map((letter) => letter.seq!);
  const through = Math.max(0, ...seqs);
  if (through === 0 || through <= (readThrough.get(conversationId) ?? 0)) return;
  readThrough.set(conversationId, through);
  setState((current) => ({ conversations: { ...current.conversations, [conversationId]: { ...conversation, unread: 0 } } }));
  try {
    applyConversation(await api<Conversation>('POST', `/api/conversations/${conversationId}/read`, { through_seq: through }));
  } catch {
    readThrough.delete(conversationId);
  }
}
