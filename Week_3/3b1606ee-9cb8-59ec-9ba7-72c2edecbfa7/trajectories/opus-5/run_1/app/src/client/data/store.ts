import type {
  AccountRecord,
  BlockRecord,
  ConfigRecord,
  ConversationRecord,
  LetterBody,
  LetterClass,
  LetterRecord,
  ProfileBody,
} from '../../shared/types.js';
import { firstLine } from '../format.js';
import { idbAll, idbDelete, idbPut, STORES } from './idb.js';

export type LocalState = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface LocalLetter {
  id: string;
  conversationId: string;
  seq: number | null;
  direction: 'sent' | 'received';
  letterClass: LetterClass;
  state: LocalState;
  failure: 'returned' | 'upload' | null;
  heldAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  returnedAt: string | null;
  retractedAt: string | null;
  canRetract: boolean;
  body: LetterBody | null;
  attachmentId: string | null;
  deletedForMe: boolean;
  uploading: boolean;
  /** Published copy shown in place of the letter when the exchange refused it. */
  refused: string | null;
  /** Held in the outbox behind the key-change stub. */
  paused: boolean;
  createdAt: number;
}

export type ConnectionState = 'online' | 'connecting';

interface State {
  config: ConfigRecord;
  me: AccountRecord | null;
  profile: ProfileBody | null;
  conversations: Map<string, ConversationRecord>;
  peerProfiles: Map<string, ProfileBody>;
  letters: Map<string, LocalLetter[]>;
  blocks: BlockRecord[];
  openConversationId: string | null;
  connection: ConnectionState;
  collecting: number;
  storageOut: boolean;
  signedOut: boolean;
}

export const state: State = {
  config: {
    attachment_max_bytes: 26_214_400,
    timers: {
      undo_ms: 5000,
      connecting_delay_ms: 2000,
      availability_debounce_ms: 300,
      retry_base_ms: 1000,
      retry_cap_ms: 60_000,
      toast_ms: 4000,
    },
    grading: false,
  },
  me: null,
  profile: null,
  conversations: new Map(),
  peerProfiles: new Map(),
  letters: new Map(),
  blocks: [],
  openConversationId: null,
  connection: 'online',
  collecting: 0,
  storageOut: false,
  signedOut: false,
};

type Listener = (detail?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

export function on(event: string, listener: Listener): void {
  const set = listeners.get(event) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(event, set);
}

export function emit(event: string, detail?: unknown): void {
  for (const listener of listeners.get(event) ?? []) listener(detail);
}

export async function loadLettersFromStore(): Promise<void> {
  const stored = await idbAll<LocalLetter>(STORES.letters);
  state.letters.clear();
  for (const letter of stored) addToMemory(letter);
  for (const letters of state.letters.values()) sortLetters(letters);
}

function sortLetters(letters: LocalLetter[]): void {
  letters.sort((a, b) => {
    if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
    if (a.seq === null && b.seq === null) return a.createdAt - b.createdAt;
    return a.seq === null ? 1 : -1;
  });
}

function addToMemory(letter: LocalLetter): void {
  const letters = state.letters.get(letter.conversationId) ?? [];
  const index = letters.findIndex((candidate) => candidate.id === letter.id);
  if (index >= 0) letters[index] = letter;
  else letters.push(letter);
  state.letters.set(letter.conversationId, letters);
}

export function lettersOf(conversationId: string): LocalLetter[] {
  return (state.letters.get(conversationId) ?? []).filter((letter) => !letter.deletedForMe);
}

export function letterById(letterId: string): LocalLetter | null {
  for (const letters of state.letters.values()) {
    const found = letters.find((letter) => letter.id === letterId);
    if (found !== undefined) return found;
  }
  return null;
}

export async function putLetter(letter: LocalLetter): Promise<void> {
  addToMemory(letter);
  const letters = state.letters.get(letter.conversationId) as LocalLetter[];
  sortLetters(letters);
  await idbPut(STORES.letters, letter);
  emit('letter', letter);
}

export async function forgetLetter(letter: LocalLetter): Promise<void> {
  const letters = state.letters.get(letter.conversationId) ?? [];
  state.letters.set(
    letter.conversationId,
    letters.filter((candidate) => candidate.id !== letter.id),
  );
  await idbDelete(STORES.letters, letter.id);
  emit('letter', letter);
}

const STATE_RANK: Record<LocalState, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/** The post answer and the socket frame race; the later state always wins. */
function latestState(record: LetterRecord, existing: LocalLetter | null): LocalLetter['state'] {
  if (existing === null) return record.state;
  return STATE_RANK[record.state] >= STATE_RANK[existing.state] ? record.state : existing.state;
}

export function letterFromRecord(
  record: LetterRecord,
  direction: 'sent' | 'received',
  body: LetterBody | null,
  existing: LocalLetter | null,
): LocalLetter {
  return {
    id: record.id,
    conversationId: record.conversation_id,
    seq: record.seq,
    direction,
    letterClass: record.class,
    state: latestState(record, existing),
    failure: record.failure,
    heldAt: record.held_at,
    deliveredAt: record.delivered_at ?? existing?.deliveredAt ?? null,
    readAt: record.read_at ?? existing?.readAt ?? null,
    returnedAt: record.returned_at,
    retractedAt: record.retracted_at,
    canRetract: record.can_retract,
    body: body ?? existing?.body ?? null,
    attachmentId: record.attachment_id,
    deletedForMe: existing?.deletedForMe ?? false,
    uploading: false,
    refused: null,
    paused: false,
    createdAt: existing?.createdAt ?? new Date(record.held_at).getTime(),
  };
}

export function conversationOf(conversationId: string): ConversationRecord | null {
  return state.conversations.get(conversationId) ?? null;
}

export function putConversation(record: ConversationRecord): void {
  state.conversations.set(record.id, record);
  emit('conversations');
}

export function conversationList(status: 'accepted' | 'request'): ConversationRecord[] {
  return [...state.conversations.values()]
    .filter((record) => record.status === status)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
}

/** The contact's display name when this device knows it, otherwise their username. */
export function peerName(record: ConversationRecord): string {
  return state.peerProfiles.get(record.peer.id)?.display_name ?? record.peer.username;
}

export function unreadTotal(): number {
  let total = 0;
  for (const record of state.conversations.values()) {
    if (record.status === 'accepted') total += record.unread;
  }
  return total;
}

export function requestCount(): number {
  return conversationList('request').length;
}

/** The first line of the last letter opened on this device. */
export function lastLetterLine(conversationId: string): LocalLetter | null {
  const letters = lettersOf(conversationId).filter(
    (letter) => letter.letterClass === 'letter',
  );
  return letters.length === 0 ? null : (letters[letters.length - 1] as LocalLetter);
}

export function previewLine(letter: LocalLetter): string {
  if (letter.body === null) return '';
  if (letter.body.kind === 'image') {
    return letter.body.text === '' ? 'Photo' : firstLine(letter.body.text);
  }
  if (letter.body.kind === 'file') return 'File';
  if (letter.body.kind === 'text') return firstLine(letter.body.text);
  return '';
}
